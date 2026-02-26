"""BudAgent orchestrator — runs the agent loop on the backend using the Agents SDK.

The orchestrator:
1. Builds context (system prompt + memories)
2. Creates an Agent with local and remote tools
3. Runs the loop in a background thread
4. Yields streaming Packet objects for the SSE response
5. Local tools are bridged to the desktop via Redis
"""

import json
import queue
import re
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
from onyx.agents.bud_agent.cron_service import create_cron_tools
from onyx.agents.bud_agent.inbox_service import create_inbox_tools
from onyx.agents.bud_agent.memory_service import create_memory_tools
from onyx.agents.bud_agent.web_search_service import BudAgentSearchContext
from onyx.agents.bud_agent.web_search_service import create_web_search_tools
from onyx.agents.bud_agent.workspace_service import create_workspace_tools
from onyx.agents.bud_agent.workspace_service import ensure_default_workspace_files
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
from onyx.server.query_and_chat.streaming_models import AgentDone
from onyx.server.query_and_chat.streaming_models import AgentSessionCompacted
from onyx.server.query_and_chat.streaming_models import AgentStopped
from onyx.server.query_and_chat.streaming_models import CitationDelta
from onyx.server.query_and_chat.streaming_models import CitationInfo
from onyx.server.query_and_chat.streaming_models import MessageDelta
from onyx.server.query_and_chat.streaming_models import MessageStart
from onyx.server.query_and_chat.streaming_models import OverallStop
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.server.query_and_chat.streaming_models import PacketException
from onyx.server.query_and_chat.streaming_models import ReasoningDelta
from onyx.server.query_and_chat.streaming_models import ReasoningStart
from onyx.server.query_and_chat.streaming_models import SectionEnd
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
        tenant_id: str = "public",
    ) -> None:
        self._session_id = session_id
        self._user = user
        self._db_session = db_session
        self._redis_client = redis_client
        self._workspace_path = workspace_path
        self._model = model
        self._timezone = timezone
        self._tenant_id = tenant_id
        self._packet_queue: queue.Queue[Packet | Exception | object] = (
            queue.Queue()
        )
        self._stop_event = threading.Event()
        self._tool_call_count = 0
        self._full_response_text = ""
        self._processed_response_text = ""  # Text with [[N]](link) citations
        self._thinking_content = ""
        self._step_number = 0
        self._message_started = False
        self._reasoning_started = False
        self._iteration_texts: list[str] = []
        self._current_iteration_text = ""
        self._stop_redis_key = f"bud_agent_stop:{self._session_id}"
        self._running_redis_key = f"bud_agent_running:{self._session_id}"
        self._running_redis_ttl = 600  # matches soft_time_limit

    @property
    def step_number(self) -> int:
        return self._step_number

    @step_number.setter
    def step_number(self, value: int) -> None:
        self._step_number = value

    def close_open_section_for_tool(self) -> int:
        """Close any open text/reasoning section and return the step for a tool.

        Called by tool functions before they emit their first packet, ensuring
        the tool section gets its own step index separate from the preceding
        text/reasoning section.

        NOTE: This may be called from the background async thread (tool
        functions) before the main thread has finished processing streaming
        events.  The main loop's iteration-end block is the authoritative
        place for saving _current_iteration_text.
        """
        if self._message_started:
            self._emit(SectionEnd())
            self._step_number += 1
            if self._current_iteration_text:
                self._iteration_texts.append(self._current_iteration_text)
            self._current_iteration_text = ""
            self._message_started = False
        elif self._reasoning_started:
            self._emit(SectionEnd())
            self._step_number += 1
            if self._current_iteration_text:
                self._iteration_texts.append(self._current_iteration_text)
            self._current_iteration_text = ""
            self._reasoning_started = False
        return self._step_number

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
                    # Serialize the error as a plain dict to avoid
                    # Pydantic serialization issues with raw exceptions.
                    error_data = {
                        "ind": self._step_number,
                        "obj": {
                            "type": "error",
                            "exception": str(packet),
                        },
                    }
                    yield get_json_line(error_data)
                    break

                # packet is a Packet — emit as JSON line
                try:
                    yield get_json_line(
                        cast(Packet, packet).model_dump(
                            mode="json",
                            exclude_none=True,
                        )
                    )
                except Exception:
                    # PacketException contains a raw Exception that Pydantic
                    # cannot serialize.  Fall back to a plain error string.
                    pkt = cast(Packet, packet)
                    if hasattr(pkt.obj, "exception"):
                        fallback = Packet(
                            ind=pkt.ind,
                            obj={"type": "error", "exception": str(pkt.obj.exception)},  # type: ignore[arg-type]
                        )
                        yield get_json_line(
                            fallback.model_dump(
                                mode="json",
                                exclude_none=True,
                            )
                        )
                    break
        finally:
            self._stop_event.set()
            wait_on_background(thread)

    def stop(self) -> None:
        """Signal the agent loop to stop gracefully."""
        self._stop_event.set()
        self._redis_client.set(self._stop_redis_key, "1", ex=300)

    def _is_stopped(self) -> bool:
        """Check if stop has been signalled via threading Event or Redis key."""
        if self._stop_event.is_set():
            return True
        try:
            val = self._redis_client.get(self._stop_redis_key)
            if val is not None:
                self._stop_event.set()
                return True
        except Exception:
            logger.warning("Failed to check Redis stop key", exc_info=True)
        return False

    def _emit(self, obj: Any, step: int | None = None) -> None:
        """Helper to put a Packet on the queue."""
        ind = step if step is not None else self._step_number
        self._packet_queue.put(Packet(ind=ind, obj=obj))

    def _run_agent_loop(self, user_message: str) -> None:
        """Background thread: run the agent loop via the Agents SDK."""
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
            ensure_default_workspace_files(
                db_session=self._db_session,
                user=self._user,
                timezone=self._timezone,
            )

            db_context = get_workspace_files_as_dict(
                db_session=self._db_session,
                user_id=self._user.id,
                paths=[
                    "AGENTS.md", "SOUL.md", "IDENTITY.md",
                    "USER.md", "MEMORY.md", "HEARTBEAT.md",
                ],
            )

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
                db_session=self._db_session,
                orchestrator=self,
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
                step_number_fn=lambda: self.close_open_section_for_tool(),
            )

            cron_tools = create_cron_tools(
                db_session=self._db_session,
                user_id=self._user.id,
            )

            inbox_tools = create_inbox_tools(
                db_session=self._db_session,
                user_id=self._user.id,
                tenant_id=self._tenant_id,
            )

            # Web search tools — reuse EXA/SERPER providers with citation tracking
            search_context = BudAgentSearchContext()

            def _increment_step() -> None:
                self._step_number += 1

            web_search_tools = create_web_search_tools(
                db_session=self._db_session,
                packet_queue=self._packet_queue,
                search_context=search_context,
                step_number_fn=lambda: self.close_open_section_for_tool(),
                step_increment_fn=_increment_step,
                session_id=self._session_id,
            )

            all_tools: list[FunctionTool] = (
                local_tools
                + memory_tools
                + workspace_tools
                + connector_tools
                + web_search_tools
                + cron_tools
                + inbox_tools
            )

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
            # "auto" is a DB placeholder for Bud Foundry — always use the
            # resolved model from get_default_llms instead.
            model_name: str = (
                llm.config.model_name
                if (not self._model or self._model == "auto")
                else self._model
            )

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
                "connector_tools=%d, web_search_tools=%d, tool_names=%s",
                model_name,
                len(all_tools),
                len(connector_tools),
                len(web_search_tools),
                [t.name for t in all_tools],
            )
            agent = Agent(
                name="BudAgent",
                model=model_name,
                tools=all_tools,
                tool_use_behavior="stop_on_first_tool",
            )

            # 6. Set up citation processing for web search results
            # Regex patterns for detecting citations in streamed text
            _citation_pattern = re.compile(
                r"(\[\[\d+\]\])|(\[\d+(?:, ?\d+)*\])"
            )
            _possible_citation_pattern = re.compile(
                r"(\[+(?:\d+,? ?)*$)"
            )
            _citation_buffer = ""
            _emitted_citation_doc_ids: set[str] = set()

            def _get_citation_link(citation_num: int) -> str:
                """Look up the link for a citation number from search context."""
                for section in search_context.cited_documents:
                    doc_id = section.center_chunk.document_id
                    num = search_context.document_id_map.get(doc_id)
                    if num == citation_num:
                        return section.center_chunk.source_links.get(0, "")
                return ""

            def _get_citation_doc_id(citation_num: int) -> str | None:
                """Look up the document_id for a citation number."""
                for doc_id, num in search_context.document_id_map.items():
                    if num == citation_num:
                        return doc_id
                return None

            def _process_citation_token(
                token: str | None,
            ) -> tuple[str, list[CitationInfo]]:
                """Process a text token for citation patterns.

                Returns (processed_text, list_of_new_citations).
                Buffers partial citation patterns (e.g. '[', '[1')
                until the full pattern is resolved.
                """
                nonlocal _citation_buffer

                if token is None:
                    # Flush remaining buffer at end of stream
                    result = _citation_buffer
                    _citation_buffer = ""
                    return result, []

                _citation_buffer += token

                # Check if we might have a partial citation at the end
                possible = bool(
                    re.search(_possible_citation_pattern, _citation_buffer)
                )
                matches = list(
                    _citation_pattern.finditer(_citation_buffer)
                )

                if not matches and possible:
                    # Hold buffer — could be start of a citation
                    return "", []

                if not matches:
                    # No citations and no partial — flush everything
                    result = _citation_buffer
                    _citation_buffer = ""
                    return result, []

                # Process found citations
                result = ""
                new_citations: list[CitationInfo] = []
                last_end = 0

                for match in matches:
                    # Text before this citation
                    result += _citation_buffer[last_end:match.start()]
                    last_end = match.end()

                    citation_str = match.group()
                    is_formatted = match.lastindex == 1  # [[N]] format

                    # Extract individual numbers
                    content = (
                        citation_str[2:-2]
                        if is_formatted
                        else citation_str[1:-1]
                    )
                    for num_str in content.split(","):
                        num = int(num_str.strip())
                        link = _get_citation_link(num)
                        doc_id = _get_citation_doc_id(num)
                        # Convert [N] → [[N]](link) for markdown rendering
                        result += f"[[{num}]]({link})"

                        if doc_id and doc_id not in _emitted_citation_doc_ids:
                            _emitted_citation_doc_ids.add(doc_id)
                            new_citations.append(
                                CitationInfo(
                                    citation_num=num,
                                    document_id=doc_id,
                                )
                            )

                # Keep any trailing partial citation in the buffer
                remainder = _citation_buffer[last_end:]
                if possible and remainder:
                    _citation_buffer = remainder
                else:
                    result += remainder
                    _citation_buffer = ""

                return result, new_citations

            # 7. Run the iterative agent loop
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
                        # Capture thinking / reasoning content
                        # Check multiple event types for compatibility
                        # with different reasoning models (Chat Completions
                        # API uses reasoning_summary_text, Responses API
                        # uses reasoning_text)
                        if (
                            ev.data.type in (
                                "response.reasoning_text.delta",
                                "response.reasoning_summary_text.delta",
                            )
                            and hasattr(ev.data, "delta")
                            and len(ev.data.delta) > 0
                        ):
                            # Emit ReasoningStart on first delta
                            if not self._reasoning_started:
                                self._emit(ReasoningStart())
                                self._reasoning_started = True
                            self._thinking_content += ev.data.delta
                            self._current_iteration_text += ev.data.delta
                            self._emit(
                                ReasoningDelta(reasoning=ev.data.delta)
                            )

                        elif (
                            ev.data.type == "response.output_text.delta"
                            and len(ev.data.delta) > 0
                        ):
                            self._full_response_text += ev.data.delta
                            self._current_iteration_text += ev.data.delta
                            # Emit MessageStart on first text delta
                            if not self._message_started:
                                # Close the thinking/reasoning section
                                # if it was started
                                if self._reasoning_started:
                                    self._emit(SectionEnd())
                                    self._step_number += 1
                                self._emit(
                                    MessageStart(
                                        content="",
                                        final_documents=None,
                                    )
                                )
                                self._message_started = True

                            # Process text through citation processor
                            # when search context has documents
                            if search_context.should_cite:
                                processed, new_citations = (
                                    _process_citation_token(ev.data.delta)
                                )
                                if processed:
                                    self._processed_response_text += processed
                                    self._emit(
                                        MessageDelta(content=processed)
                                    )
                                if new_citations:
                                    self._emit(
                                        CitationDelta(
                                            citations=new_citations
                                        )
                                    )
                            else:
                                self._processed_response_text += ev.data.delta
                                self._emit(
                                    MessageDelta(content=ev.data.delta)
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

                # Inject citation context when web search tools have
                # accumulated documents and the agent is about to generate
                # a final text response (i.e. after tool calls).
                if (
                    has_tool_calls
                    and search_context.should_cite
                    and search_context.cited_documents
                ):
                    citation_instruction = (
                        search_context.build_citation_instruction()
                    )
                    if citation_instruction:
                        messages.append({
                            "role": "user",
                            "content": citation_instruction,
                        })

                if not has_tool_calls or self._is_stopped():
                    last_call_is_final = True
                else:
                    # Save intermediate text from this iteration.
                    # This is the authoritative save point — it runs on the
                    # main thread after all stream events have been processed,
                    # so _current_iteration_text is guaranteed to be complete.
                    # (close_open_section_for_tool() may have already saved
                    # it from the background thread, but if so it will have
                    # reset _current_iteration_text to "" and this is a no-op.)
                    if self._current_iteration_text:
                        self._iteration_texts.append(
                            self._current_iteration_text
                        )
                        self._current_iteration_text = ""
                    # Reset for next iteration — section should already be
                    # closed by close_open_section_for_tool(), but reset
                    # defensively for the next streaming pass.
                    self._message_started = False
                    self._reasoning_started = False

            # Flush any remaining citation buffer
            if search_context.should_cite and _citation_buffer:
                flushed, flush_citations = _process_citation_token(None)
                if flushed:
                    self._processed_response_text += flushed
                    self._emit(MessageDelta(content=flushed))
                if flush_citations:
                    self._emit(
                        CitationDelta(citations=flush_citations)
                    )

            # 8. Emit completion or stopped packet
            if self._is_stopped():
                # Close any open section before stopping
                if self._reasoning_started and not self._message_started:
                    self._emit(SectionEnd())
                    self._step_number += 1
                self._emit(AgentStopped())
                self._step_number += 1
                update_session_status(
                    self._db_session,
                    self._session_id,
                    AgentSessionStatus.STOPPED,
                )
            else:
                # Close the message section (or reasoning if no message)
                self._emit(SectionEnd())
                self._step_number += 1
                self._emit(OverallStop())

            # 8. Persist the assistant response
            if self._full_response_text:
                # Use processed text (with [[N]](link) citations) if available
                persist_content = (
                    self._processed_response_text
                    if self._processed_response_text
                    else self._full_response_text
                )

                # Build ui_spec with citation metadata for history reconstruction
                ui_spec: dict[str, Any] | None = None
                if search_context.should_cite and search_context.cited_documents:
                    citations_data: list[dict[str, Any]] = []
                    seen_doc_ids: set[str] = set()
                    for section in search_context.cited_documents:
                        doc_id = section.center_chunk.document_id
                        if doc_id in seen_doc_ids:
                            continue
                        seen_doc_ids.add(doc_id)
                        num = search_context.document_id_map.get(doc_id)
                        link = section.center_chunk.source_links.get(0, "")
                        title = (
                            section.center_chunk.title
                            or section.center_chunk.semantic_identifier
                        )
                        citations_data.append({
                            "citation_num": num,
                            "document_id": doc_id,
                            "link": link,
                            "title": title,
                        })

                    # Build search docs data for the document map
                    search_docs_data: list[dict[str, Any]] = []
                    for section in search_context.cited_documents:
                        doc_id = section.center_chunk.document_id
                        link = section.center_chunk.source_links.get(0, "")
                        title = (
                            section.center_chunk.title
                            or section.center_chunk.semantic_identifier
                        )
                        search_docs_data.append({
                            "document_id": doc_id,
                            "semantic_identifier": title,
                            "link": link,
                            "source_type": "web",
                            "is_internet": True,
                        })

                    ui_spec = {
                        "citations": citations_data,
                        "search_docs": search_docs_data,
                    }

                # Attach intermediate reasoning texts for history reconstruction
                if self._iteration_texts:
                    if ui_spec is None:
                        ui_spec = {}
                    ui_spec["intermediate_texts"] = self._iteration_texts

                add_session_message(
                    db_session=self._db_session,
                    session_id=self._session_id,
                    role=AgentMessageRole.ASSISTANT,
                    content=persist_content,
                    step_number=self._step_number,
                    thinking_content=self._thinking_content or None,
                    ui_spec=ui_spec,
                )

            # 9. Update session usage stats
            update_session_stats(
                self._db_session,
                self._session_id,
                tool_calls=self._tool_call_count,
            )

            # 10. Signal that we are done
            self._emit(AgentDone())

        except Exception as e:
            logger.exception(
                "BudAgent orchestrator error for session %s", self._session_id
            )
            # Put the raw exception on the queue so the run() method's
            # isinstance(packet, Exception) handler can catch it and
            # serialize it as a plain error string.
            self._packet_queue.put(e)
            self._emit(AgentDone())
        finally:
            # Clean up Redis keys — delete individually because
            # TenantRedis._prefix_method only prefixes the first
            # positional arg, so passing multiple keys to a single
            # delete() call leaves the second key un-prefixed.
            try:
                self._redis_client.delete(self._stop_redis_key)
                self._redis_client.delete(self._running_redis_key)
            except Exception:
                logger.warning(
                    "Failed to clean up one or more agent Redis keys "
                    "for session %s",
                    self._session_id,
                    exc_info=True,
                )
            self._packet_queue.put(_SENTINEL)

    def _compact_session(
        self,
        user_message: str,
        llm: Any,
    ) -> UUID | None:
        """Compact the current session by summarizing it and creating a new linked session."""
        previous_messages = get_session_messages(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        if not previous_messages:
            return None

        conversation_text = []
        for msg in previous_messages:
            role = msg.role.value if hasattr(msg.role, "value") else str(msg.role)
            content = msg.content or ""
            if content:
                conversation_text.append(f"[{role}]: {content}")

        conversation_str = "\n".join(conversation_text)
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

        summary_response = llm.invoke(summarization_prompt)
        summary = str(summary_response.content).strip()

        if not summary:
            logger.warning("Compaction produced empty summary, skipping")
            return None

        mark_session_compacted(
            db_session=self._db_session,
            session_id=self._session_id,
        )

        new_session = create_compacted_session(
            db_session=self._db_session,
            user_id=self._user.id,
            parent_session_id=self._session_id,
            compaction_summary=summary,
            workspace_path=self._workspace_path,
        )

        add_session_message(
            db_session=self._db_session,
            session_id=new_session.id,
            role=AgentMessageRole.USER,
            content=user_message,
        )

        # Emit as a Packet
        self._emit(
            AgentSessionCompacted(
                new_session_id=str(new_session.id),
                summary=summary,
            )
        )

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
        """Build an Agents SDK RunConfig from Onyx's LLM configuration."""
        api_key = llm.config.api_key or "not-needed"
        api_base = llm.config.api_base

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
        """Build the message list for the Agents SDK from stored session history."""
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
        ]

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
            # NOTE: TOOL messages are persisted for history reconstruction
            # (packet_utils.py) but are NOT included in the LLM message
            # history because they lack matching tool_calls on the
            # assistant message, which would violate the OpenAI API format.

        system_chars = len(system_prompt)
        budget = MAX_HISTORY_CHARS - system_chars
        if budget < 0:
            budget = 50_000

        total_chars = sum(len(str(m.get("content", ""))) for m in history)
        if total_chars > budget:
            logger.info(
                "Truncating history for session %s: %d chars > %d budget",
                self._session_id,
                total_chars,
                budget,
            )
            while history and total_chars > budget:
                dropped = history.pop(0)
                total_chars -= len(str(dropped.get("content", "")))

        messages.extend(history)
        return messages
