"""Sub-session tool implementations for BudAgent.

Provides service functions that are wrapped as Agents SDK FunctionTool
objects for the agent to manage sub-sessions: spawn, list, inspect,
get results, cancel, and send follow-up messages.

All DB operations are delegated to ``onyx.db.agent`` and
``onyx.db.agent_events``.
"""

import asyncio
import json
from datetime import datetime
from datetime import timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.db.agent import count_active_sub_sessions
from onyx.db.agent import create_sub_session
from onyx.db.agent import get_session_for_user
from onyx.db.agent import get_session_messages
from onyx.db.agent import get_sub_sessions_for_parent
from onyx.db.agent import set_session_stop_flag
from onyx.db.agent import update_session_status
from onyx.db.agent_events import enqueue_session_event
from onyx.db.enums import AgentEventType
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import AgentSession
from onyx.redis.redis_pool import get_redis_client
from onyx.utils.logger import setup_logger

logger = setup_logger()

# Concurrency limit for sub-sessions per user
_DEFAULT_CONCURRENCY_LIMIT = 10

# Context truncation: ~4K tokens = ~16K chars
_MAX_CONTEXT_CHARS = 16_000

# Persistent sub-session inactivity timeout (seconds).
# Must match PERSISTENT_SUB_SESSION_EXPIRY_SECONDS in
# onyx.background.celery.tasks.sub_session.tasks.
PERSISTENT_SUB_SESSION_EXPIRY_SECONDS: int = 3600  # 1 hour


def _short_label(text: str, max_words: int = 5) -> str:
    """Truncate text to first N words for display as a short label."""
    if not text:
        return ""
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]) + "..."


# ---------------------------------------------------------------------------
# Service functions
# ---------------------------------------------------------------------------


def spawn_sub_session(
    db_session: Session,
    user_id: UUID,
    parent_session_id: UUID,
    task: str,
    task_name: str | None = None,
    task_context: str | None = None,
    mode: str = "one_shot",
    timeout_seconds: int | None = None,
    max_turns: int | None = None,
    tenant_id: str = "public",
) -> dict[str, object]:
    """Spawn a new sub-session for the given parent session.

    Checks the concurrency limit before creating the session and
    dispatches the Celery task for background execution.
    """
    # 1. Check concurrency limit (uses SELECT ... FOR UPDATE)
    active_count = count_active_sub_sessions(db_session, user_id)
    if active_count >= _DEFAULT_CONCURRENCY_LIMIT:
        return {
            "status": "rejected",
            "reason": "concurrency_limit",
            "active_count": active_count,
            "limit": _DEFAULT_CONCURRENCY_LIMIT,
        }

    # 2. Truncate context if too large
    truncated_context: str | None = task_context
    if truncated_context and len(truncated_context) > _MAX_CONTEXT_CHARS:
        truncated_context = truncated_context[:_MAX_CONTEXT_CHARS] + "... (truncated)"

    # 3. Map mode to session_type
    session_type: str
    if mode == "persistent":
        session_type = "SUB_PERSISTENT"
    else:
        session_type = "SUB_ONE_SHOT"

    # 4. Create the sub-session
    # Use task_name as the short title; auto-derive from first few words if not provided
    if task_name:
        title = _short_label(task_name)
    else:
        title = _short_label(task)
    session = create_sub_session(
        db_session=db_session,
        user_id=user_id,
        parent_session_id=parent_session_id,
        task_description=task,
        task_context=truncated_context,
        session_type=session_type,
        max_turns=max_turns,
        title=title,
    )

    # 5. Dispatch Celery task via client app (API server doesn't have worker broker)
    from onyx.background.celery.apps.client import celery_app as client_celery_app
    from onyx.configs.constants import OnyxCeleryTask

    client_celery_app.send_task(
        OnyxCeleryTask.EXECUTE_SUB_SESSION,
        kwargs={"session_id": str(session.id), "tenant_id": tenant_id},
    )

    # 6. Emit agent:sub_session_spawned via Socket.IO.
    # This runs in the API server process which holds the sio instance,
    # so we can emit directly without going through Redis pub/sub.
    try:
        from onyx.server.agent.socketio_server import emit_sub_session_event

        spawn_data: dict[str, Any] = {
            "type": "SUB_SESSION_SPAWNED",
            "parent_session_id": str(parent_session_id),
            "sub_session_id": str(session.id),
            "task": task,
            "task_name": title,
            "mode": mode,
        }
        # Schedule the async emit on the running event loop.  The tool
        # handler itself is async so there should always be a loop.
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(
                emit_sub_session_event(
                    parent_session_id=str(parent_session_id),
                    event_name="agent:sub_session_spawned",
                    data=spawn_data,
                )
            )
        except RuntimeError:
            # No running loop (shouldn't happen in normal flow)
            logger.debug(
                "spawn_sub_session: no running event loop, "
                "skipping Socket.IO emit for session %s",
                session.id,
            )
    except Exception:
        logger.warning(
            "spawn_sub_session: failed to emit agent:sub_session_spawned "
            "for session %s",
            session.id,
            exc_info=True,
        )

    return {
        "session_id": str(session.id),
        "status": "accepted",
    }


def list_sub_sessions(
    db_session: Session,
    parent_session_id: UUID,
    status_filter: str | None = None,
    limit: int = 20,
) -> list[dict[str, object]]:
    """List sub-sessions for a parent session.

    Optionally filters by status. Returns at most *limit* results.
    """
    sessions = get_sub_sessions_for_parent(db_session, parent_session_id)

    # Filter by status if provided
    if status_filter:
        sessions = [
            s for s in sessions
            if s.status.value == status_filter.upper()
        ]

    # Limit results
    sessions = sessions[:limit]

    results: list[dict[str, object]] = []
    for s in sessions:
        # Count actual turns (USER messages) instead of max_turns limit
        user_msg_count = sum(
            1 for m in (s.messages or []) if m.role.value == "USER"
        )
        results.append({
            "session_id": str(s.id),
            "task": s.task_description or "",
            "task_name": _short_label(s.title or s.task_description or ""),
            "status": s.status.value,
            "execution_status": s.execution_status.value if s.execution_status else "IDLE",
            "session_type": s.session_type or "",
            "created_at": s.created_at.isoformat() if s.created_at else "",
            "updated_at": s.updated_at.isoformat() if s.updated_at else "",
            "tokens_used": s.total_tokens_used,
            "tool_calls": s.total_tool_calls,
            "turns": user_msg_count,
        })
    return results


def inspect_sub_session(
    db_session: Session,
    session_id: UUID,
    user_id: UUID,
    include_history: bool = False,
) -> dict[str, object]:
    """Inspect a sub-session, optionally including message history.

    Verifies the session belongs to the requesting user.
    """
    session = get_session_for_user(db_session, session_id, user_id)
    if session is None:
        return {"error": "Session not found or not owned by you."}

    result: dict[str, object] = {
        "session_id": str(session.id),
        "task": session.task_description or "",
        "status": session.status.value,
        "session_type": session.session_type or "",
        "created_at": session.created_at.isoformat() if session.created_at else "",
        "updated_at": session.updated_at.isoformat() if session.updated_at else "",
        "tokens_used": session.total_tokens_used,
        "tool_calls": session.total_tool_calls,
        "turns": sum(1 for m in (session.messages or []) if m.role.value == "USER"),
        "parent_session_id": str(session.parent_session_id) if session.parent_session_id else None,
    }

    if include_history:
        messages = get_session_messages(db_session, session_id)
        history: list[dict[str, object]] = []
        for m in messages:
            entry: dict[str, object] = {
                "role": m.role.value,
                "content": m.content or "",
            }
            if m.tool_name:
                entry["tool_name"] = m.tool_name
            if m.tool_output:
                entry["tool_output"] = m.tool_output
            if m.tool_error:
                entry["tool_error"] = m.tool_error
            history.append(entry)
        result["history"] = history

    return result


def get_sub_session_result(
    db_session: Session,
    session_id: UUID,
    user_id: UUID,
) -> dict[str, object]:
    """Get the result of a completed or failed sub-session.

    Returns the summary extracted from the last assistant message,
    along with status and metrics.
    """
    session = get_session_for_user(db_session, session_id, user_id)
    if session is None:
        return {"error": "Session not found or not owned by you."}

    if session.status not in (AgentSessionStatus.COMPLETED, AgentSessionStatus.FAILED):
        return {
            "error": f"Session is still running (status={session.status.value}). "
                     "STOP — do NOT call this tool again. The result will be "
                     "delivered automatically as a system message when the "
                     "sub-session completes. Tell the user it's in progress "
                     "and end your turn.",
            "status": session.status.value,
        }

    # Extract summary from the last assistant message
    messages = get_session_messages(db_session, session_id)
    summary: str = "(no summary available)"
    for m in reversed(messages):
        if m.role.value == "ASSISTANT" and m.content:
            summary = m.content
            # Truncate long summaries
            if len(summary) > 2000:
                summary = summary[:2000] + "..."
            break

    return {
        "session_id": str(session.id),
        "status": session.status.value,
        "task": session.task_description or "",
        "summary": summary,
        "tokens_used": session.total_tokens_used,
        "tool_calls": session.total_tool_calls,
    }


def cancel_sub_session(
    db_session: Session,
    session_id: UUID,
    user_id: UUID,
    reason: str | None = None,
    tenant_id: str = "public",
) -> dict[str, object]:
    """Cancel a running sub-session by setting the Redis stop flag.

    The sub-session executor checks this flag periodically and will
    stop execution when it sees it.
    """
    session = get_session_for_user(db_session, session_id, user_id)
    if session is None:
        return {"error": "Session not found or not owned by you."}

    if session.status != AgentSessionStatus.ACTIVE:
        return {
            "error": f"Session is not active (status={session.status.value}).",
            "status": session.status.value,
        }

    # Set the Redis stop flag
    redis_client = get_redis_client(tenant_id=tenant_id)
    set_session_stop_flag(redis_client, session_id)

    return {"status": "cancelling", "session_id": str(session_id)}


def _is_persistent_session_expired(session: AgentSession) -> bool:
    """Check if a SUB_PERSISTENT session has expired due to inactivity.

    A session is expired when it has been COMPLETED for longer than
    ``PERSISTENT_SUB_SESSION_EXPIRY_SECONDS``.
    """
    if session.session_type != "SUB_PERSISTENT":
        return False
    if session.status != AgentSessionStatus.COMPLETED:
        return False
    if session.completed_at is None:
        return False
    expiry_cutoff = datetime.utcnow() - timedelta(
        seconds=PERSISTENT_SUB_SESSION_EXPIRY_SECONDS
    )
    return session.completed_at < expiry_cutoff


def send_to_sub_session(
    db_session: Session,
    session_id: UUID,
    user_id: UUID,
    message: str,
    tenant_id: str = "public",
) -> dict[str, object]:
    """Send a message to a sub-session.

    Enqueues a SUB_SESSION_FOLLOW_UP event. If the sub-session worker
    is not running, dispatches a new Celery task to resume execution.

    Works for both ONE_SHOT and PERSISTENT sub-sessions.
    Returns an error if a persistent session has expired due to inactivity.
    """
    session = get_session_for_user(db_session, session_id, user_id)
    if session is None:
        return {"error": "Session not found or not owned by you."}

    if session.session_type not in ("SUB_ONE_SHOT", "SUB_PERSISTENT"):
        return {"error": "send_to_sub_session is only for sub-sessions."}

    # Check for expiry on completed persistent sessions
    if _is_persistent_session_expired(session):
        return {
            "status": "error",
            "reason": "session_expired",
            "message": (
                "Session has expired after "
                f"{PERSISTENT_SUB_SESSION_EXPIRY_SECONDS // 3600} hour(s) "
                "of inactivity"
            ),
        }

    # Enqueue the follow-up event
    enqueue_session_event(
        db_session=db_session,
        session_id=session_id,
        event_type=AgentEventType.SUB_SESSION_FOLLOW_UP,
        payload={"message": message},
    )

    # Check if the sub-session worker is still running
    redis_client = get_redis_client(tenant_id=tenant_id)
    heartbeat_key = f"bud_agent_running:{session_id}"
    worker_running: bool = redis_client.exists(heartbeat_key) > 0

    if not worker_running:
        # Re-dispatch the Celery task via client app
        from onyx.background.celery.apps.client import celery_app as client_celery_app
        from onyx.configs.constants import OnyxCeleryTask

        client_celery_app.send_task(
            OnyxCeleryTask.EXECUTE_SUB_SESSION,
            kwargs={"session_id": str(session_id), "tenant_id": tenant_id},
        )

        # Re-activate the session if it was completed
        if session.status != AgentSessionStatus.ACTIVE:
            update_session_status(db_session, session_id, AgentSessionStatus.ACTIVE)

    return {"status": "delivered", "session_id": str(session_id)}


# ---------------------------------------------------------------------------
# FunctionTool factories for the Agents SDK
# ---------------------------------------------------------------------------


def create_sub_session_tools(
    db_session: Session,
    user_id: UUID,
    parent_session_id: UUID,
    tenant_id: str = "public",
) -> list[Any]:
    """Create Agents SDK FunctionTool objects for sub-session management.

    Returns a list of ``FunctionTool`` instances for spawn, list,
    inspect, get_result, cancel, and send_to.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS

    tools: list[FunctionTool] = []

    # ── spawn_sub_session ────────────────────────────────────────────────
    spawn_schema = REMOTE_TOOL_SCHEMAS["spawn_sub_session"]

    async def _handle_spawn(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            task = args.get("task", "")
            if not task:
                return "Error: 'task' is required."

            result = spawn_sub_session(
                db_session=db_session,
                user_id=user_id,
                parent_session_id=parent_session_id,
                task=task,
                task_name=args.get("task_name"),
                task_context=args.get("task_context"),
                mode=args.get("mode", "one_shot"),
                timeout_seconds=args.get("timeout_seconds"),
                max_turns=args.get("max_turns"),
                tenant_id=tenant_id,
            )
            return json.dumps(result)
        except Exception as e:
            logger.exception("spawn_sub_session failed")
            return f"Error: {e}"

    tools.append(
        FunctionTool(
            name="spawn_sub_session",
            description=spawn_schema["description"],
            params_json_schema=spawn_schema["parameters"],
            on_invoke_tool=_handle_spawn,
        )
    )

    # ── list_sub_sessions ────────────────────────────────────────────────
    list_schema = REMOTE_TOOL_SCHEMAS["list_sub_sessions"]

    async def _handle_list(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            result = list_sub_sessions(
                db_session=db_session,
                parent_session_id=parent_session_id,
                status_filter=args.get("status_filter"),
                limit=min(int(args.get("limit", 20)), 50),
            )
            return json.dumps(result)
        except Exception as e:
            logger.exception("list_sub_sessions failed")
            return f"Error: {e}"

    tools.append(
        FunctionTool(
            name="list_sub_sessions",
            description=list_schema["description"],
            params_json_schema=list_schema["parameters"],
            on_invoke_tool=_handle_list,
        )
    )

    # ── inspect_sub_session ──────────────────────────────────────────────
    inspect_schema = REMOTE_TOOL_SCHEMAS["inspect_sub_session"]

    async def _handle_inspect(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            sid = args.get("session_id", "")
            if not sid:
                return "Error: 'session_id' is required."

            result = inspect_sub_session(
                db_session=db_session,
                session_id=UUID(sid),
                user_id=user_id,
                include_history=bool(args.get("include_history", False)),
            )
            return json.dumps(result)
        except Exception as e:
            logger.exception("inspect_sub_session failed")
            return f"Error: {e}"

    tools.append(
        FunctionTool(
            name="inspect_sub_session",
            description=inspect_schema["description"],
            params_json_schema=inspect_schema["parameters"],
            on_invoke_tool=_handle_inspect,
        )
    )

    # ── get_sub_session_result ───────────────────────────────────────────
    result_schema = REMOTE_TOOL_SCHEMAS["get_sub_session_result"]

    async def _handle_get_result(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            sid = args.get("session_id", "")
            if not sid:
                return "Error: 'session_id' is required."

            result = get_sub_session_result(
                db_session=db_session,
                session_id=UUID(sid),
                user_id=user_id,
            )
            return json.dumps(result)
        except Exception as e:
            logger.exception("get_sub_session_result failed")
            return f"Error: {e}"

    tools.append(
        FunctionTool(
            name="get_sub_session_result",
            description=result_schema["description"],
            params_json_schema=result_schema["parameters"],
            on_invoke_tool=_handle_get_result,
        )
    )

    # ── cancel_sub_session ───────────────────────────────────────────────
    cancel_schema = REMOTE_TOOL_SCHEMAS["cancel_sub_session"]

    async def _handle_cancel(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            sid = args.get("session_id", "")
            if not sid:
                return "Error: 'session_id' is required."

            result = cancel_sub_session(
                db_session=db_session,
                session_id=UUID(sid),
                user_id=user_id,
                reason=args.get("reason"),
                tenant_id=tenant_id,
            )
            return json.dumps(result)
        except Exception as e:
            logger.exception("cancel_sub_session failed")
            return f"Error: {e}"

    tools.append(
        FunctionTool(
            name="cancel_sub_session",
            description=cancel_schema["description"],
            params_json_schema=cancel_schema["parameters"],
            on_invoke_tool=_handle_cancel,
        )
    )

    # ── send_to_sub_session ──────────────────────────────────────────────
    send_schema = REMOTE_TOOL_SCHEMAS["send_to_sub_session"]

    async def _handle_send(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            sid = args.get("session_id", "")
            msg = args.get("message", "")
            if not sid:
                return "Error: 'session_id' is required."
            if not msg:
                return "Error: 'message' is required."

            result = send_to_sub_session(
                db_session=db_session,
                session_id=UUID(sid),
                user_id=user_id,
                message=msg,
                tenant_id=tenant_id,
            )
            return json.dumps(result)
        except Exception as e:
            logger.exception("send_to_sub_session failed")
            return f"Error: {e}"

    tools.append(
        FunctionTool(
            name="send_to_sub_session",
            description=send_schema["description"],
            params_json_schema=send_schema["parameters"],
            on_invoke_tool=_handle_send,
        )
    )

    return tools
