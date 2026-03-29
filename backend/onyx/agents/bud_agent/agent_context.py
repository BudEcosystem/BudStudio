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
from dataclasses import field
from enum import Enum
from typing import Any
from uuid import UUID

import redis
from agents import Agent
from agents import FunctionTool
from agents import RunConfig
from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.artifact_tool import create_artifact_tool
from onyx.agents.bud_agent.ask_user_tool import create_ask_user_tool
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
from onyx.db.agent import update_session_stats
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
    EXTERNAL = "external"


# Static tool blocklist per execution mode.
# Applied after tool assembly, before skill tools.
MODE_TOOL_BLOCKLIST: dict[AgentExecutionMode, set[str]] = {
    AgentExecutionMode.INTERACTIVE: set(),  # all tools allowed
    AgentExecutionMode.CRON: {
        "ask_user_questions",   # user not present
        "render_canvas",        # no frontend to display it
    },
    AgentExecutionMode.INBOX: {
        "ask_user_questions",   # user not present
        "render_canvas",        # no frontend to display it
        "manage_cron",          # inbox shouldn't schedule jobs
    },
    AgentExecutionMode.EXTERNAL: {
        "ask_user_questions",   # user not present
        "render_canvas",        # no frontend to display it
        "manage_cron",          # external triggers shouldn't schedule jobs
        # send_message NOT blocked — agent may need to notify user
    },
}


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
    packet_queue: queue.Queue | None = None
    connector_approval_tools: set[str] = field(default_factory=set)
    connector_approval_gateway: dict[str, str] = field(default_factory=dict)


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

    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=api_key,
        base_url=api_base,
        default_headers=extra_headers if extra_headers else None,
    )
    model = OpenAIChatCompletionsModel(
        model=model_name,
        openai_client=client,
        # Always replay reasoning_content on assistant messages so the
        # provider sees prior chain-of-thought across turns.
        should_replay_reasoning_content=lambda _ctx: True,
    )
    return RunConfig(model=model)


# ---------------------------------------------------------------------------
# 4. build_agent_run_context
# ---------------------------------------------------------------------------


def build_agent_run_context(
    session_id: UUID,
    user: User,
    db_session: Session,
    search_query: str,
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
    blocking_tools: bool = True,
    tool_filter_fn: Callable[[str, list[FunctionTool]], list[FunctionTool]] | None = None,
) -> AgentRunContext:
    """Build the full agent execution context shared by all orchestrators.

    ``search_query`` is used **only** for memory search and skill
    discovery in the system prompt — it never reaches the LLM's
    message list.  Pass the original user message so these searches
    return meaningful results on every turn.

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
            "AGENTS.md",
            "SOUL.md",
            "IDENTITY.md",
            "USER.md",
            "MEMORY.md",
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
    connector_tools, connector_approval_names, connector_gateway_map = (
        create_connector_tools(
            db_session=db_session,
            user=user,
            session_id=session_id,
            packet_queue=resolved_packet_queue,
            step_number_fn=resolved_step_number_fn,
            auto_approve=mode in (
                AgentExecutionMode.CRON,
                AgentExecutionMode.INBOX,
                AgentExecutionMode.EXTERNAL,
            ),
        )
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

    # Step 6b: resolve LLM early so artifact tool can use it
    llm, _ = get_default_llms(user=user)
    model_name: str = llm.config.model_name if (not model or model == "auto") else model
    # When the user picks a specific model, override the LLM's internal
    # model version so downstream callers (e.g. artifact generation) use
    # the same model.  llm.config is a property that creates a new
    # LLMConfig each time, so we must set the backing attribute directly.
    if model_name != llm.config.model_name:
        llm._model_version = model_name

    artifact_tools = create_artifact_tool(
        session_id=session_id,
        packet_queue=resolved_packet_queue,
        step_number_fn=resolved_step_number_fn,
        db_session=db_session,
        llm=llm,
    )
    ask_user_tools = create_ask_user_tool(
        session_id=session_id,
        packet_queue=resolved_packet_queue,
        step_number_fn=resolved_step_number_fn,
        db_session=db_session,
        redis_client=resolved_redis,
        blocking=blocking_tools,
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
    resolved_local_tools: list[FunctionTool] = (
        local_tools if local_tools is not None else []
    )

    # Step 9: extra tools
    resolved_extra_tools: list[FunctionTool] = (
        extra_tools if extra_tools is not None else []
    )

    # Step 10: concatenate all tools
    all_tools: list[FunctionTool] = (
        resolved_local_tools
        + memory_tools
        + workspace_tools
        + connector_tools
        + default_mcp_tools
        + web_search_tools
        + cron_tools
        + artifact_tools
        + ask_user_tools
        + resolved_inbox_tools
        + resolved_extra_tools
    )

    # Step 10a: mode-based static blocklist
    blocked = MODE_TOOL_BLOCKLIST.get(mode, set())
    if blocked:
        all_tools = [t for t in all_tools if t.name not in blocked]

    # Step 10b: optional per-turn dynamic filtering (for architecture #5)
    if tool_filter_fn and search_query:
        all_tools = tool_filter_fn(search_query, all_tools)

    # Step 10c: skill tools (use_skill FunctionTool + catalog for prompt)
    available_tool_names: set[str] = {t.name for t in all_tools}
    skill_tools, skills_catalog = create_skill_tools(
        db_session=db_session,
        available_tools=available_tool_names,
        mode=mode.value,
        user_message=search_query,
        user_id=user.id,
    )
    all_tools.extend(skill_tools)

    # Step 11: connector tool names
    connector_tool_names: list[str] = [t.name for t in connector_tools] + [
        t.name for t in default_mcp_tools
    ]

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
        user_message=search_query,
        connector_tool_names=connector_tool_names,
        skills_catalog=skills_catalog,
    )

    # Step 13: build RunConfig (LLM resolved in step 6b above)
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
        packet_queue=resolved_packet_queue,
        connector_approval_tools=connector_approval_names,
        connector_approval_gateway=connector_gateway_map,
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

    # ── Pre-process: group messages into turns ──
    # The DB may store TOOL results before their ASSISTANT message
    # (remote tools execute during the LLM stream, so their results
    # are persisted before the assistant message).  We need to
    # reorder so that reasoning + assistant content always precedes
    # the function_call items.  We do this by scanning ahead.
    #
    # Build a list of (ASSISTANT, [TOOL...]) groups.  Any TOOL
    # messages that appear before an ASSISTANT are associated with
    # the next ASSISTANT in sequence.

    msg_list = list(previous_messages)

    def _emit_reasoning(thinking: str, msg_id: Any) -> None:
        """Append a reasoning item to history."""
        history.append(
            {
                "type": "reasoning",
                "id": f"rs_{msg_id}",
                "summary": [{"type": "summary_text", "text": thinking}],
                "content": [{"type": "reasoning_text", "text": thinking}],
            }
        )

    def _emit_tool_pairs(
        tools: list[Any],
        thinking: str | None = None,
        thinking_msg_id: Any = None,
    ) -> None:
        """Emit tool calls in Responses-API format.

        All function_call items are emitted FIRST, then all
        function_call_output items.  This prevents the SDK converter
        from flushing the assistant message between tool calls, which
        would lose the reasoning_content on subsequent calls.

        The SDK converter groups consecutive function_call items into
        a single assistant message and attaches pending reasoning
        blocks to it.  By keeping all function_calls together (before
        any function_call_output), the reasoning is preserved on the
        one assistant message that holds all tool_calls.
        """
        if thinking:
            _emit_reasoning(thinking, thinking_msg_id)

        # First: all function_call items (grouped into one assistant msg by SDK)
        for t in tools:
            call_id: str = t.tool_call_id or t.tool_name or "unknown"
            history.append(
                {
                    "type": "function_call",
                    "call_id": call_id,
                    "name": t.tool_name or "unknown",
                    "arguments": json.dumps(t.tool_input) if t.tool_input else "{}",
                }
            )

        # Then: all function_call_output items
        for t in tools:
            call_id = t.tool_call_id or t.tool_name or "unknown"
            output: str = (
                json.dumps(t.tool_output) if t.tool_output else (t.tool_error or "")
            )
            history.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                }
            )

    pending_tools: list[Any] = []

    i = 0
    while i < len(msg_list):
        msg = msg_list[i]

        if msg.role == AgentMessageRole.USER:
            # Flush any orphaned tools before the user message
            if pending_tools:
                _emit_tool_pairs(pending_tools)
                pending_tools = []
            history.append({"role": "user", "content": msg.content or ""})
            i += 1

        elif msg.role == AgentMessageRole.TOOL:
            # Buffer — will be flushed when we hit ASSISTANT or end
            pending_tools.append(msg)
            i += 1

        elif msg.role == AgentMessageRole.ASSISTANT:
            # Collect all tools associated with this assistant turn:
            # pending tools (persisted before ASSISTANT) + following tools.
            all_turn_tools: list[Any] = list(pending_tools)
            pending_tools = []

            j = i + 1
            while j < len(msg_list) and msg_list[j].role == AgentMessageRole.TOOL:
                all_turn_tools.append(msg_list[j])
                j += 1

            has_tools = len(all_turn_tools) > 0

            if has_tools:
                # Emit all function_calls grouped together (then all
                # outputs) so the SDK converter creates ONE assistant
                # message with all tool_calls + reasoning_content.
                _emit_tool_pairs(
                    all_turn_tools,
                    thinking=msg.thinking_content,
                    thinking_msg_id=msg.id,
                )
            else:
                # No tools — emit reasoning + assistant message normally.
                if msg.thinking_content:
                    _emit_reasoning(msg.thinking_content, msg.id)
                # Only emit assistant message when there's actual text.
                # Don't emit empty {role: "assistant", content: ""}
                # for thinking-only turns — the reasoning block suffices.
                if msg.content:
                    history.append(
                        {
                            "role": "assistant",
                            "content": msg.content,
                        }
                    )

            # If there's text content alongside tools, emit it after
            if has_tools and msg.content:
                history.append({"role": "assistant", "content": msg.content})

            i = j
        else:
            i += 1

    # Flush any remaining tool messages at the end
    if pending_tools:
        _emit_tool_pairs(pending_tools)
        pending_tools = []

    # Truncate history from the front when exceeding budget
    system_chars = len(system_prompt)
    budget = max_history_chars - system_chars
    if budget < 0:
        budget = 50_000

    def _item_chars(m: dict[str, Any]) -> int:
        """Estimate char count for a history item (message or reasoning)."""
        if m.get("type") == "reasoning":
            summaries = m.get("summary", [])
            return sum(len(s.get("text", "")) for s in summaries)
        return len(str(m.get("content", "")))

    total_chars = sum(_item_chars(m) for m in history)
    if total_chars > budget:
        logger.info(
            "Truncating history for session %s: %d chars > %d budget",
            session_id,
            total_chars,
            budget,
        )
        while history and total_chars > budget:
            dropped = history.pop(0)
            total_chars -= _item_chars(dropped)

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
# persist_turn_result
# ---------------------------------------------------------------------------


def persist_turn_result(
    db_session: Session,
    session_id: UUID,
    response_text: str | None,
    thinking_content: str | None = None,
    tool_call_count: int = 0,
    step_number: int | None = None,
    ui_spec: dict[str, Any] | None = None,
) -> None:
    """Persist an assistant turn result to the database.

    Combines the message persistence + stats update pattern that is
    duplicated across all orchestrator implementations.
    """
    if response_text or thinking_content:
        add_session_message(
            db_session=db_session,
            session_id=session_id,
            role=AgentMessageRole.ASSISTANT,
            content=response_text or "",
            step_number=step_number,
            thinking_content=thinking_content,
            ui_spec=ui_spec,
        )

    update_session_stats(
        db_session, session_id, tool_calls=tool_call_count
    )



# run_sync_agent_loop and SyncLoopResult have been removed.
# Cron and inbox orchestrators now use TurnDriver directly.
