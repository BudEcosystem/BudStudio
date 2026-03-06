"""Shared setup logic for the BudAgent orchestrators.

Extracts context-building, message-history construction, session
compaction, and the synchronous agent loop into reusable functions so
that the interactive, cron, and inbox orchestrators can share a single
code path for common work.
"""

import json
import queue
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
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
from onyx.agents.bud_agent.connector_service import create_connector_tools
from onyx.agents.bud_agent.context_builder import BudAgentContextBuilder
from onyx.agents.bud_agent.cron_service import create_cron_tools
from onyx.agents.bud_agent.inbox_service import create_inbox_tools
from onyx.agents.bud_agent.mcp_service import create_default_mcp_tools
from onyx.agents.bud_agent.memory_service import create_memory_tools
from onyx.agents.bud_agent.skill_service import create_skill_tools
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
from onyx.db.enums import AgentMessageRole
from onyx.db.models import User
from onyx.llm.factory import get_default_llms
from onyx.redis.redis_pool import get_redis_client
from onyx.server.query_and_chat.streaming_models import Packet
from onyx.utils.logger import setup_logger

logger = setup_logger()

# History truncation: ~4 chars per token, limit to ~100K tokens
MAX_HISTORY_CHARS = 400_000


# ---------------------------------------------------------------------------
# 1. AgentExecutionMode
# ---------------------------------------------------------------------------

class AgentExecutionMode(str, Enum):
    INTERACTIVE = "interactive"
    CRON = "cron"
    INBOX = "inbox"


# ---------------------------------------------------------------------------
# 2. AgentRunContext
# ---------------------------------------------------------------------------

@dataclass
class AgentRunContext:
    agent: Agent
    run_config: RunConfig
    search_context: BudAgentSearchContext
    llm: Any
    model_name: str
    connector_tool_names: list[str]
    system_prompt: str
    db_context: dict[str, str]
    compaction_summary: str | None
    mode: AgentExecutionMode


# ---------------------------------------------------------------------------
# 3. build_run_config
# ---------------------------------------------------------------------------

def build_run_config(llm: Any, model_name: str) -> RunConfig:
    """Build an Agents SDK RunConfig from Onyx's LLM configuration."""
    api_key: str = llm.config.api_key or "not-needed"
    api_base: str | None = llm.config.api_base

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


# ---------------------------------------------------------------------------
# 4. build_agent_run_context
# ---------------------------------------------------------------------------

def build_agent_run_context(
    session_id: UUID,
    user: User,
    db_session: Session,
    user_message: str,
    mode: AgentExecutionMode,
    local_tools: list[FunctionTool] | None = None,
    inbox_tools: list[FunctionTool] | None = None,
    extra_tools: list[FunctionTool] | None = None,
    redis_client: redis.Redis | None = None,  # type: ignore[type-arg]
    tenant_id: str = "public",
    workspace_path: str | None = None,
    model: str | None = None,
    timezone: str | None = None,
    packet_queue: queue.Queue[Packet | Exception | object] | None = None,
    step_number_fn: Callable[[], int] | None = None,
    step_increment_fn: Callable[[], None] | None = None,
) -> AgentRunContext:
    """Build the full agent execution context shared by all orchestrators.

    Returns an ``AgentRunContext`` containing the Agent, RunConfig,
    system prompt, tools, and related metadata.
    """
    # Step 1: ensure default workspace files exist
    ensure_default_workspace_files(
        db_session=db_session,
        user=user,
        timezone=timezone,
    )

    # Step 2: load workspace files
    db_context = get_workspace_files_as_dict(
        db_session=db_session,
        user_id=user.id,
        paths=[
            "AGENTS.md", "SOUL.md", "IDENTITY.md",
            "USER.md", "MEMORY.md",
        ],
    )

    # Step 3: load session and extract compaction_summary
    current_session = get_session(
        db_session=db_session,
        session_id=session_id,
    )
    compaction_summary: str | None = (
        current_session.compaction_summary if current_session else None
    )

    # Step 4: defaults for optional parameters
    resolved_packet_queue: queue.Queue[Packet | Exception | object] = (
        packet_queue or queue.Queue()
    )
    resolved_redis: redis.Redis = (  # type: ignore[type-arg]
        redis_client or get_redis_client(tenant_id=tenant_id)
    )
    resolved_step_number_fn: Callable[[], int] = step_number_fn or (lambda: 0)
    resolved_step_increment_fn: Callable[[], None] = step_increment_fn or (lambda: None)

    # Step 5: search context
    search_context = BudAgentSearchContext()

    # Step 6: standard tools
    memory_tools = create_memory_tools(
        db_session=db_session,
        user_id=user.id,
        session_id=session_id,
    )
    workspace_tools = create_workspace_tools(
        db_session=db_session,
        user_id=user.id,
    )
    connector_tools = create_connector_tools(
        db_session=db_session,
        user=user,
        session_id=session_id,
        packet_queue=resolved_packet_queue,
        redis_client=resolved_redis,
        step_number_fn=resolved_step_number_fn,
    )
    default_mcp_tools = create_default_mcp_tools(
        db_session=db_session,
        session_id=session_id,
        packet_queue=resolved_packet_queue,
        step_number_fn=resolved_step_number_fn,
    )
    web_search_tools = create_web_search_tools(
        db_session=db_session,
        packet_queue=resolved_packet_queue,
        search_context=search_context,
        step_number_fn=resolved_step_number_fn,
        step_increment_fn=resolved_step_increment_fn,
        session_id=session_id,
    )
    cron_tools = create_cron_tools(
        db_session=db_session,
        user_id=user.id,
    )

    # Step 7: inbox tools
    resolved_inbox_tools: list[FunctionTool] = (
        inbox_tools
        if inbox_tools is not None
        else create_inbox_tools(
            db_session=db_session,
            user_id=user.id,
            tenant_id=tenant_id,
        )
    )

    # Step 8: local tools
    resolved_local_tools: list[FunctionTool] = local_tools if local_tools is not None else []

    # Step 9: extra tools
    resolved_extra_tools: list[FunctionTool] = extra_tools if extra_tools is not None else []

    # Step 10: concatenate all tools
    all_tools: list[FunctionTool] = (
        resolved_local_tools
        + memory_tools
        + workspace_tools
        + connector_tools
        + default_mcp_tools
        + web_search_tools
        + cron_tools
        + resolved_inbox_tools
        + resolved_extra_tools
    )

    # Step 10b: skill tools (use_skill FunctionTool + catalog for prompt)
    available_tool_names: set[str] = {t.name for t in all_tools}
    skill_tools, skills_catalog = create_skill_tools(
        db_session=db_session,
        available_tools=available_tool_names,
        mode=mode.value,
    )
    all_tools.extend(skill_tools)

    # Step 11: connector tool names
    connector_tool_names: list[str] = (
        [t.name for t in connector_tools]
        + [t.name for t in default_mcp_tools]
    )

    # Step 12: build system prompt
    context_builder = BudAgentContextBuilder(
        workspace_path=workspace_path,
        context_files=db_context,
        user_timezone=timezone,
        compaction_summary=compaction_summary,
        mode=mode.value,
    )
    system_prompt: str = context_builder.build(
        db_session=db_session,
        user_id=user.id,
        user_message=user_message,
        connector_tool_names=connector_tool_names,
        skills_catalog=skills_catalog,
    )

    # Step 13: resolve LLM and model name
    llm, _ = get_default_llms(user=user)
    model_name: str = (
        llm.config.model_name
        if (not model or model == "auto")
        else model
    )

    # Step 14: build RunConfig
    run_config = build_run_config(llm, model_name)

    # Step 15: create the Agent
    agent = Agent(
        name="BudAgent",
        model=model_name,
        tools=all_tools,
        tool_use_behavior="stop_on_first_tool",
    )

    # Step 16: return context
    return AgentRunContext(
        agent=agent,
        run_config=run_config,
        search_context=search_context,
        llm=llm,
        model_name=model_name,
        connector_tool_names=connector_tool_names,
        system_prompt=system_prompt,
        db_context=db_context,
        compaction_summary=compaction_summary,
        mode=mode,
    )


# ---------------------------------------------------------------------------
# 5. build_message_history
# ---------------------------------------------------------------------------

def build_message_history(
    db_session: Session,
    session_id: UUID,
    system_prompt: str,
    max_history_chars: int = MAX_HISTORY_CHARS,
) -> list[dict[str, Any]]:
    """Build the message list for the Agents SDK from stored session history.

    Includes TOOL messages as ``function_call`` / ``function_call_output``
    pairs so the model can reason about prior tool interactions.

    NOTE: This does NOT persist the user message. Each caller handles
    persistence separately.
    """
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": system_prompt},
    ]

    previous_messages = get_session_messages(
        db_session=db_session,
        session_id=session_id,
    )

    history: list[dict[str, Any]] = []

    # Buffer consecutive TOOL messages so they can be flushed as
    # Responses-API-format function_call + function_call_output pairs.
    pending_tools: list[Any] = []

    def _flush_tools() -> None:
        if not pending_tools:
            return
        for t in pending_tools:
            call_id: str = t.tool_call_id or t.tool_name or "unknown"
            history.append({
                "type": "function_call",
                "call_id": call_id,
                "name": t.tool_name or "unknown",
                "arguments": json.dumps(t.tool_input) if t.tool_input else "{}",
            })
            output: str = (
                json.dumps(t.tool_output)
                if t.tool_output
                else (t.tool_error or "")
            )
            history.append({
                "type": "function_call_output",
                "call_id": call_id,
                "output": output,
            })
        pending_tools.clear()

    for msg in previous_messages:
        if msg.role == AgentMessageRole.TOOL:
            pending_tools.append(msg)
            continue

        # Flush any buffered tool messages before the next non-tool msg
        _flush_tools()

        if msg.role == AgentMessageRole.USER:
            history.append({"role": "user", "content": msg.content or ""})
        elif msg.role == AgentMessageRole.ASSISTANT:
            if msg.content:
                history.append({"role": "assistant", "content": msg.content})

    # Flush remaining tool messages at the end
    _flush_tools()

    # Truncate history from the front when exceeding budget
    system_chars = len(system_prompt)
    budget = max_history_chars - system_chars
    if budget < 0:
        budget = 50_000

    total_chars = sum(len(str(m.get("content", ""))) for m in history)
    if total_chars > budget:
        logger.info(
            "Truncating history for session %s: %d chars > %d budget",
            session_id,
            total_chars,
            budget,
        )
        while history and total_chars > budget:
            dropped = history.pop(0)
            total_chars -= len(str(dropped.get("content", "")))

    messages.extend(history)
    return messages


# ---------------------------------------------------------------------------
# 6. compact_session
# ---------------------------------------------------------------------------

def compact_session(
    db_session: Session,
    session_id: UUID,
    user: User,
    user_message: str,
    llm: Any,
    workspace_path: str | None = None,
) -> tuple[UUID, str] | None:
    """Compact a session by summarizing it and creating a new linked session.

    Returns ``(new_session_id, summary)`` on success, or ``None`` if
    compaction is skipped (e.g. no previous messages or empty summary).
    """
    previous_messages = get_session_messages(
        db_session=db_session,
        session_id=session_id,
    )

    if not previous_messages:
        return None

    conversation_text: list[str] = []
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
    summary: str = str(summary_response.content).strip()

    if not summary:
        logger.warning("Compaction produced empty summary, skipping")
        return None

    mark_session_compacted(
        db_session=db_session,
        session_id=session_id,
    )

    new_session = create_compacted_session(
        db_session=db_session,
        user_id=user.id,
        parent_session_id=session_id,
        compaction_summary=summary,
        workspace_path=workspace_path,
    )

    # Persist the current user message in the new session
    add_session_message(
        db_session=db_session,
        session_id=new_session.id,
        role=AgentMessageRole.USER,
        content=user_message,
    )

    logger.info(
        "Compacted session %s -> new session %s",
        session_id,
        new_session.id,
    )

    return new_session.id, summary


# ---------------------------------------------------------------------------
# 7. SyncLoopResult + run_sync_agent_loop
# ---------------------------------------------------------------------------

@dataclass
class SyncLoopResult:
    response_text: str = ""
    tool_call_count: int = 0
    final_messages: list[dict[str, Any]] | None = None


def run_sync_agent_loop(
    agent: Agent,
    messages: list[dict[str, Any]],
    run_config: RunConfig,
    max_tool_calls: int = 50,
    should_stop: Callable[[], bool] | None = None,
) -> SyncLoopResult:
    """Run the iterative agent loop synchronously until completion.

    This is the shared loop used by the cron and inbox orchestrators.
    The interactive orchestrator has its own streaming-aware loop with
    citation processing and SSE packet emission.

    Parameters
    ----------
    agent:
        The ``Agent`` instance to run.
    messages:
        The initial message list (system + history + user message).
    run_config:
        Agents SDK ``RunConfig`` with provider credentials.
    max_tool_calls:
        Hard cap on tool invocations to prevent runaway loops.
    should_stop:
        Optional callable returning ``True`` when the loop should
        terminate early (e.g. suspension or escalation).
    """
    result = SyncLoopResult()
    last_call_is_final = False

    while not last_call_is_final:
        if result.tool_call_count >= max_tool_calls:
            logger.warning(
                "Max tool calls (%d) reached in sync agent loop",
                max_tool_calls,
            )
            break

        if should_stop is not None and should_stop():
            break

        stream = SyncAgentStream(
            agent=agent,
            input=messages,
            context=None,
            run_config=run_config,
        )

        has_tool_calls = False
        for ev in stream:
            if isinstance(ev, RawResponsesStreamEvent):
                if (
                    ev.data.type == "response.output_text.delta"
                    and len(ev.data.delta) > 0
                ):
                    result.response_text += ev.data.delta

            if isinstance(getattr(ev, "item", None), ToolCallItem):
                has_tool_calls = True
                result.tool_call_count += 1

        if stream.streamed is None:
            break

        messages = cast(
            list[dict[str, Any]], stream.streamed.to_input_list()
        )

        if not has_tool_calls:
            last_call_is_final = True

        # Check early-exit after processing (e.g. suspension flag set by tool)
        if should_stop is not None and should_stop():
            break

    result.final_messages = messages
    return result
