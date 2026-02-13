"""BudAgent orchestrator — runs the agent loop on the backend using the Agents SDK.

The orchestrator:
1. Builds context (system prompt + memories)
2. Creates an Agent with local and remote tools
3. Runs the loop in a background thread
4. Yields streaming packets for the SSE response
5. Local tools are bridged to the desktop via Redis
"""

import json
import queue
import threading
from collections.abc import Generator
from typing import Any
from typing import cast
from uuid import UUID

import redis
from agents import Agent
from agents import FunctionTool
from agents import RawResponsesStreamEvent
from agents import RunConfig
from agents import ToolCallItem
from agents.models.openai_provider import OpenAIProvider
from openai import AsyncOpenAI
from sqlalchemy.orm import Session

from onyx.agents.agent_sdk.sync_agent_stream_adapter import SyncAgentStream
from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder
from onyx.agents.bud_agent.local_tool_bridge import LocalToolBridge
from onyx.agents.bud_agent.connector_service import create_connector_tools
from onyx.agents.bud_agent.memory_service import create_memory_tools
from onyx.agents.bud_agent.workspace_service import create_workspace_tools
from onyx.agents.bud_agent.workspace_service import ensure_default_workspace_files
from onyx.agents.bud_agent.streaming_models import BudAgentComplete
from onyx.agents.bud_agent.streaming_models import BudAgentDone
from onyx.agents.bud_agent.streaming_models import BudAgentError
from onyx.agents.bud_agent.streaming_models import BudAgentPacket
from onyx.agents.bud_agent.streaming_models import BudAgentSessionCompacted
from onyx.agents.bud_agent.streaming_models import BudAgentStopped
from onyx.agents.bud_agent.streaming_models import BudAgentText
from onyx.agents.bud_agent.streaming_models import BudAgentThinking
from onyx.db.agent import add_session_message
from onyx.db.agent import create_compacted_session
from onyx.db.agent import get_session
from onyx.db.agent import get_session_messages
from onyx.db.agent import get_workspace_files_as_dict
from onyx.db.agent import mark_session_compacted
from onyx.db.agent import update_session_stats
from onyx.db.agent import update_session_status
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import User
from onyx.llm.factory import get_default_llms
from onyx.server.utils import get_json_line
from onyx.utils.logger import setup_logger
from onyx.utils.threadpool_concurrency import run_in_background
from onyx.utils.threadpool_concurrency import wait_on_background

logger = setup_logger()

MAX_TOOL_CALLS = 50
KEEPALIVE_INTERVAL_SECONDS = 15
# History truncation: ~4 chars per token, limit to ~100K tokens
MAX_HISTORY_CHARS = 400_000
# Compaction threshold: trigger compaction before the hard truncation limit
COMPACTION_THRESHOLD_CHARS = 300_000

_SENTINEL = object()


class BudAgentOrchestrator:
    """Orchestrates the BudAgent execution loop.

    The orchestrator builds context, creates an Agent with local + remote tools,
    runs the agent loop in a background thread, and yields SSE packets to the
    API endpoint via a thread-safe queue.
    """

    def __init__(
        self,
        session_id: UUID,
        user: User,
        db_session: Session,
        redis_client: redis.Redis,  # type: ignore[type-arg]
        workspace_path: str | None = None,
        model: str | None = None,
        timezone: str | None = None,
    ) -> None:
        self._session_id = session_id
        self._user = user
        self._db_session = db_session
        self._redis_client = redis_client
        self._workspace_path = workspace_path
        self._model = model
        self._timezone = timezone
        self._packet_queue: queue.Queue[BudAgentPacket | Exception | object] = (
            queue.Queue()
        )
        self._stop_event = threading.Event()
        self._tool_call_count = 0
        self._full_response_text = ""
        self._stop_redis_key = f"bud_agent_stop:{self._session_id}"
        self._running_redis_key = f"bud_agent_running:{self._session_id}"
        self._running_redis_ttl = 600  # matches soft_time_limit

    def run(self, user_message: str) -> Generator[str, None, None]:
        """Run the agent loop and yield JSON-line packets for SSE streaming."""
        # Persist the user message before starting the agent loop
        add_session_message(
            db_session=self._db_session,
            session_id=self._session_id,
            role=AgentMessageRole.USER,
            content=user_message,
        )

        # Start the agent loop in a background thread
        thread = run_in_background(
            lambda: self._run_agent_loop(user_message)
        )

        # Yield packets from the queue until the agent loop completes
        try:
            while True:
                try:
                    packet = self._packet_queue.get(
                        timeout=KEEPALIVE_INTERVAL_SECONDS
                    )
                except queue.Empty:
                    # Send SSE keepalive comment to prevent connection timeout
                    yield ": keepalive\n\n"
                    continue

                if packet is _SENTINEL:
                    break

                if isinstance(packet, Exception):
                    error_packet = BudAgentError(error=str(packet))
                    yield get_json_line(error_packet.model_dump())
                    break

                # packet is a BudAgentPacket — emit as JSON line
                yield get_json_line(cast(BudAgentPacket, packet).model_dump())
        finally:
            self._stop_event.set()
            wait_on_background(thread)

    def stop(self) -> None:
        """Signal the agent loop to stop gracefully."""
        self._stop_event.set()
        self._redis_client.set(self._stop_redis_key, "1", ex=300)

    def _is_stopped(self) -> bool:
        """Check if stop has been signalled via threading Event or Redis key.

        The threading.Event is set when stop() is called directly on this
        orchestrator instance. The Redis key is set by the /stop API endpoint
        (which may not have a reference to this orchestrator object).
        Both paths need to be checked.
        """
        if self._stop_event.is_set():
            return True
        try:
            val = self._redis_client.get(self._stop_redis_key)
            if val is not None:
                self._stop_event.set()  # Sync the threading event
                return True
        except Exception:
            logger.warning("Failed to check Redis stop key", exc_info=True)
        return False

    def _run_agent_loop(self, user_message: str) -> None:
        """Background thread: run the agent loop via the Agents SDK.

        All exceptions are caught and forwarded as error packets through the
        queue so the SSE generator never raises unexpectedly.
        """
        try:
            # Set the "session is busy" flag so cron tasks skip this session
            try:
                self._redis_client.set(
                    self._running_redis_key, "1", ex=self._running_redis_ttl
                )
            except Exception:
                logger.warning(
                    "Failed to set Redis running key", exc_info=True
                )

            # 1. Build the system prompt with memory + context
            # Seed default workspace files if this is the user's first run
            ensure_default_workspace_files(
                db_session=self._db_session,
                user=self._user,
                timezone=self._timezone,
            )

            # Load workspace files from DB to populate context_files.
            db_context = get_workspace_files_as_dict(
                db_session=self._db_session,
                user_id=self._user.id,
                paths=[
                    "AGENTS.md", "SOUL.md", "IDENTITY.md",
                    "USER.md", "MEMORY.md", "HEARTBEAT.md",
                ],
            )

            # Check for a compaction summary on the current session
            current_session = get_session(
                db_session=self._db_session,
                session_id=self._session_id,
            )
            compaction_summary = (
                current_session.compaction_summary if current_session else None
            )

            # 2. Build tools — local tools bridge to the desktop via Redis
            local_bridge = LocalToolBridge(
                session_id=str(self._session_id),
                packet_queue=self._packet_queue,
                redis_client=self._redis_client,
            )
            local_tools = local_bridge.create_all_local_tools()

            # Remote tools — execute directly on the backend
            memory_tools = create_memory_tools(
                db_session=self._db_session,
                user_id=self._user.id,
                session_id=self._session_id,
            )
            workspace_tools = create_workspace_tools(
                db_session=self._db_session,
                user_id=self._user.id,
            )
            connector_tools = create_connector_tools(
                db_session=self._db_session,
                user=self._user,
                session_id=self._session_id,
                packet_queue=self._packet_queue,
                redis_client=self._redis_client,
            )
            all_tools: list[FunctionTool] = (
                local_tools + memory_tools + workspace_tools + connector_tools
            )

            # Build connector tools section for the system prompt
            connector_tool_names = [t.name for t in connector_tools]

            context_builder = BudAgentContextBuilder(
                workspace_path=self._workspace_path,
                context_files=db_context,
                user_timezone=self._timezone,
                compaction_summary=compaction_summary,
            )
            system_prompt = context_builder.build(
                db_session=self._db_session,
                user_id=self._user.id,
                user_message=user_message,
                connector_tool_names=connector_tool_names,
            )

            # 3. Resolve the LLM model and build RunConfig with credentials
            llm, _ = get_default_llms(user=self._user)
            model_name: str = self._model or llm.config.model_name

            # Build an AsyncOpenAI client with the LLM provider's credentials
            # so the Agents SDK can make authenticated API calls
            run_config = self._build_run_config(llm, model_name)

            # 4. Build the message history for the agent
            messages = self._build_messages(system_prompt)

            # 4a. Check if history exceeds compaction threshold
            history_chars = sum(
                len(str(m.get("content", "")))
                for m in messages
                if m.get("role") != "system"
            )
            if history_chars > COMPACTION_THRESHOLD_CHARS:
                try:
                    new_session_id = self._compact_session(
                        user_message=user_message,
                        llm=llm,
                    )
                    if new_session_id is not None:
                        # Reload context + messages for the new session
                        new_session = get_session(
                            db_session=self._db_session,
                            session_id=new_session_id,
                        )
                        context_builder = BudAgentContextBuilder(
                            workspace_path=self._workspace_path,
                            context_files=db_context,
                            user_timezone=self._timezone,
                            compaction_summary=(
                                new_session.compaction_summary
                                if new_session
                                else None
                            ),
                        )
                        system_prompt = context_builder.build(
                            db_session=self._db_session,
                            user_id=self._user.id,
                            user_message=user_message,
                            connector_tool_names=connector_tool_names,
                        )
                        messages = self._build_messages(system_prompt)

                        # Update local bridge session ID
                        local_bridge._session_id = str(new_session_id)
                except Exception:
                    logger.warning(
                        "Compaction failed for session %s, falling back to truncation",
                        self._session_id,
                        exc_info=True,
                    )

            # 5. Create the agent
            logger.info(
                "Creating agent with model=%s, total_tools=%d, "
                "connector_tools=%d, tool_names=%s",
                model_name,
                len(all_tools),
                len(connector_tools),
                [t.name for t in connector_tools[:5]],
            )
            agent = Agent(
                name="BudAgent",
                model=model_name,
                tools=all_tools,
                tool_use_behavior="stop_on_first_tool",
            )

            # 6. Run the iterative agent loop
            self._packet_queue.put(BudAgentThinking())
            last_call_is_final = False

            while not last_call_is_final and not self._is_stopped():
                if self._tool_call_count >= MAX_TOOL_CALLS:
                    logger.warning(
                        "Max tool calls (%d) reached for session %s",
                        MAX_TOOL_CALLS,
                        self._session_id,
                    )
                    break

                stream = SyncAgentStream(
                    agent=agent,
                    input=messages,
                    context=None,
                    run_config=run_config,
                )

                has_tool_calls = False
                for ev in stream:
                    if self._is_stopped():
                        stream.cancel()
                        break

                    # Handle streaming text deltas
                    if isinstance(ev, RawResponsesStreamEvent):
                        if (
                            ev.data.type == "response.output_text.delta"
                            and len(ev.data.delta) > 0
                        ):
                            self._full_response_text += ev.data.delta
                            self._packet_queue.put(
                                BudAgentText(content=ev.data.delta)
                            )

                    # Detect tool calls
                    if isinstance(getattr(ev, "item", None), ToolCallItem):
                        has_tool_calls = True
                        self._tool_call_count += 1

                if stream.streamed is None:
                    break

                # Advance the message history with the agent's output
                messages = cast(
                    list[dict[str, Any]], stream.streamed.to_input_list()
                )

                if not has_tool_calls or self._is_stopped():
                    last_call_is_final = True

            # 7. Emit completion or stopped packet
            if self._is_stopped():
                self._packet_queue.put(BudAgentStopped())
                update_session_status(
                    self._db_session,
                    self._session_id,
                    AgentSessionStatus.STOPPED,
                )
            else:
                self._packet_queue.put(
                    BudAgentComplete(content=self._full_response_text)
                )

            # 8. Persist the assistant response
            if self._full_response_text:
                add_session_message(
                    db_session=self._db_session,
                    session_id=self._session_id,
                    role=AgentMessageRole.ASSISTANT,
                    content=self._full_response_text,
                )

            # 9. Update session usage stats
            update_session_stats(
                self._db_session,
                self._session_id,
                tool_calls=self._tool_call_count,
            )

            # 10. Signal that we are done
            self._packet_queue.put(BudAgentDone())

        except Exception as e:
            logger.exception(
                "BudAgent orchestrator error for session %s", self._session_id
            )
            self._packet_queue.put(BudAgentError(error=str(e)))
            self._packet_queue.put(BudAgentDone())
            # Keep the session ACTIVE so the user can retry after transient
            # errors (e.g. 401 invalid API key, network timeouts).  The error
            # is already surfaced to the frontend via the BudAgentError packet.
        finally:
            # Clean up Redis keys (stop key + running flag)
            try:
                self._redis_client.delete(
                    self._stop_redis_key, self._running_redis_key
                )
            except Exception:
                pass
            self._packet_queue.put(_SENTINEL)

    def _compact_session(
        self,
        user_message: str,
        llm: Any,
    ) -> UUID | None:
        """Compact the current session by summarizing it and creating a new linked session.

        Returns the new session ID on success, or None if compaction is skipped.
        """
        # Load the full message history from the current session
        previous_messages = get_session_messages(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        if not previous_messages:
            return None

        # Build a summarization prompt with the conversation history
        conversation_text = []
        for msg in previous_messages:
            role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
            content = msg.content or ""
            if content:
                conversation_text.append(f"[{role}]: {content}")

        conversation_str = "\n".join(conversation_text)
        # Truncate if extremely long to fit in the summarization call
        if len(conversation_str) > 100_000:
            conversation_str = (
                conversation_str[:70_000]
                + "\n\n... (middle truncated) ...\n\n"
                + conversation_str[-25_000:]
            )

        summarization_prompt = (
            "You are a concise summarization assistant. Below is a conversation "
            "between a user and an AI agent. Summarize the key topics discussed, "
            "decisions made, tasks completed, and any important context that would "
            "help continue the conversation seamlessly. Be concise but comprehensive. "
            "Focus on facts, outcomes, and ongoing tasks.\n\n"
            f"Conversation:\n{conversation_str}\n\n"
            "Summary:"
        )

        # Call LLM directly for a single-shot summary
        summary_response = llm.invoke(summarization_prompt)
        summary = str(summary_response.content).strip()

        if not summary:
            logger.warning("Compaction produced empty summary, skipping")
            return None

        # Mark the old session as compacted
        mark_session_compacted(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        # Create the new linked session
        new_session = create_compacted_session(
            db_session=self._db_session,
            user_id=self._user.id,
            parent_session_id=self._session_id,
            compaction_summary=summary,
            workspace_path=self._workspace_path,
        )

        # Persist the current user message in the new session
        add_session_message(
            db_session=self._db_session,
            session_id=new_session.id,
            role=AgentMessageRole.USER,
            content=user_message,
        )

        # Emit the compaction event to the frontend
        self._packet_queue.put(
            BudAgentSessionCompacted(
                new_session_id=str(new_session.id),
                summary=summary,
            )
        )

        # Update internal state
        old_session_id = self._session_id
        self._session_id = new_session.id
        self._stop_redis_key = f"bud_agent_stop:{self._session_id}"

        logger.info(
            "Compacted session %s -> new session %s",
            old_session_id,
            new_session.id,
        )

        return new_session.id

    @staticmethod
    def _build_run_config(
        llm: Any,
        model_name: str,
    ) -> RunConfig:
        """Build an Agents SDK RunConfig from Onyx's LLM configuration.

        Extracts the API key, base URL, and extra headers (e.g., OAuth token)
        from the resolved LLM object and creates an AsyncOpenAI client that
        the Agents SDK can use for authenticated API calls.
        """
        api_key = llm.config.api_key or "not-needed"
        api_base = llm.config.api_base

        # Extract extra_headers from the LLM's model_kwargs (contains OAuth token
        # for Bud Foundry and similar providers)
        extra_headers: dict[str, str] = {}
        if hasattr(llm, "_model_kwargs"):
            extra_headers = llm._model_kwargs.get("extra_headers", {})

        client = AsyncOpenAI(
            api_key=api_key,
            base_url=api_base,
            default_headers=extra_headers if extra_headers else None,
        )
        provider = OpenAIProvider(
            openai_client=client,
            use_responses=False,
        )
        return RunConfig(model_provider=provider)

    def _build_messages(
        self,
        system_prompt: str,
    ) -> list[dict[str, Any]]:
        """Build the message list for the Agents SDK from stored session history.

        The system prompt is injected as the first message. Previous
        conversation messages are loaded from the database. If the total
        character count exceeds MAX_HISTORY_CHARS, older messages are
        dropped (keeping the system prompt and the most recent messages).
        """
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]

        # Load all messages from the session (includes the user message we
        # just persisted in run())
        previous_messages = get_session_messages(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        history: list[dict[str, Any]] = []
        for msg in previous_messages:
            if msg.role == AgentMessageRole.USER:
                history.append({"role": "user", "content": msg.content or ""})
            elif msg.role == AgentMessageRole.ASSISTANT:
                history.append(
                    {"role": "assistant", "content": msg.content or ""}
                )
            elif msg.role == AgentMessageRole.TOOL:
                history.append({
                    "role": "tool",
                    "content": (
                        json.dumps(msg.tool_output)
                        if msg.tool_output
                        else (msg.tool_error or "")
                    ),
                    "tool_call_id": msg.tool_name or "",
                })

        # Truncate history if it exceeds budget (keep most recent messages)
        system_chars = len(system_prompt)
        budget = MAX_HISTORY_CHARS - system_chars
        if budget < 0:
            budget = 50_000  # minimum budget for history

        total_chars = sum(len(str(m.get("content", ""))) for m in history)
        if total_chars > budget:
            logger.info(
                "Truncating history for session %s: %d chars > %d budget",
                self._session_id,
                total_chars,
                budget,
            )
            # Drop oldest messages until we fit
            while history and total_chars > budget:
                dropped = history.pop(0)
                total_chars -= len(str(dropped.get("content", "")))

        messages.extend(history)
        return messages
