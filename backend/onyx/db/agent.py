"""Database operations for agent sessions and messages."""

from datetime import datetime
from datetime import timedelta
from typing import Any
from uuid import UUID

import redis
from sqlalchemy import desc
from sqlalchemy import exists
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import Session

from onyx.db.enums import AgentMemorySource
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionExecutionStatus
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import AgentMemory
from onyx.db.models import AgentMessage
from onyx.db.models import AgentSession
from onyx.db.models import AgentWorkspaceFile


def _deactivate_user_sessions(
    db_session: Session,
    user_id: UUID | None,
) -> None:
    """Mark all ACTIVE sessions for a user as COMPLETED so only one remains active."""
    stmt = (
        update(AgentSession)
        .where(
            AgentSession.user_id == user_id,
            AgentSession.status == AgentSessionStatus.ACTIVE,
        )
        .values(
            status=AgentSessionStatus.COMPLETED,
            completed_at=datetime.utcnow(),
        )
    )
    db_session.execute(stmt)


def create_session(
    db_session: Session,
    user_id: UUID | None,
    title: str | None = None,
    workspace_path: str | None = None,
) -> AgentSession:
    """Create a new agent session for the user.

    Deactivates any existing ACTIVE sessions first so only one is active at a time.
    Active sub-sessions of the old session are re-pointed to the new session
    so they are not orphaned (design decision 0.3).
    """
    # Capture the current active session ID *before* deactivation so we can
    # re-point its sub-sessions to the new session afterwards.
    old_active_stmt = (
        select(AgentSession.id)
        .where(
            AgentSession.user_id == user_id,
            AgentSession.status == AgentSessionStatus.ACTIVE,
        )
        .limit(1)
    )
    old_active_id: UUID | None = db_session.execute(old_active_stmt).scalar_one_or_none()

    _deactivate_user_sessions(db_session, user_id)

    session = AgentSession(
        user_id=user_id,
        title=title,
        workspace_path=workspace_path,
        status=AgentSessionStatus.ACTIVE,
        session_type="INTERACTIVE",
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)

    # Re-point active sub-sessions from the old session to the newly created one.
    if old_active_id is not None:
        repoint_sub_sessions_parent(db_session, old_active_id, session.id)

    return session


def create_cron_session(
    db_session: Session,
    user_id: UUID | None,
    title: str | None = None,
    workspace_path: str | None = None,
) -> AgentSession:
    """Create an agent session for a cron job execution.

    Unlike create_session(), this does NOT deactivate existing ACTIVE
    sessions for the user. Cron sessions are isolated and must not
    interfere with interactive sessions.
    """
    session = AgentSession(
        user_id=user_id,
        title=title,
        workspace_path=workspace_path,
        status=AgentSessionStatus.ACTIVE,
        session_type="CRON",
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session


def get_session(
    db_session: Session,
    session_id: UUID,
) -> AgentSession | None:
    """Get an agent session by ID."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    return db_session.execute(stmt).scalar_one_or_none()


def get_session_for_user(
    db_session: Session,
    session_id: UUID,
    user_id: UUID | None,
) -> AgentSession | None:
    """Get an agent session by ID, ensuring it belongs to the specified user."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)

    # If user_id is provided, filter by it; otherwise allow access (admin case)
    if user_id is not None:
        stmt = stmt.where(AgentSession.user_id == user_id)

    return db_session.execute(stmt).scalar_one_or_none()


def get_user_sessions(
    db_session: Session,
    user_id: UUID | None,
    include_completed: bool = True,
    limit: int | None = None,
) -> list[AgentSession]:
    """Get all agent sessions for a user, ordered by most recent first."""
    stmt = select(AgentSession).where(AgentSession.user_id == user_id)

    if not include_completed:
        stmt = stmt.where(AgentSession.status == AgentSessionStatus.ACTIVE)

    stmt = stmt.order_by(desc(AgentSession.updated_at))

    if limit is not None:
        stmt = stmt.limit(limit)

    return list(db_session.execute(stmt).scalars().all())


def get_session_messages(
    db_session: Session,
    session_id: UUID,
    limit: int | None = None,
    offset: int = 0,
) -> list[AgentMessage]:
    """Get all messages for a session, ordered by creation time."""
    stmt = (
        select(AgentMessage)
        .where(AgentMessage.session_id == session_id)
        .order_by(AgentMessage.created_at)
    )

    if offset > 0:
        stmt = stmt.offset(offset)

    if limit is not None:
        stmt = stmt.limit(limit)

    return list(db_session.execute(stmt).scalars().all())


def add_session_message(
    db_session: Session,
    session_id: UUID,
    role: AgentMessageRole,
    content: str | None = None,
    tool_name: str | None = None,
    tool_input: dict[str, Any] | None = None,
    tool_output: dict[str, Any] | None = None,
    tool_error: str | None = None,
    tool_call_id: str | None = None,
    step_number: int | None = None,
    thinking_content: str | None = None,
    ui_spec: dict[str, Any] | None = None,
) -> AgentMessage:
    """Add a new message to an agent session."""
    message = AgentMessage(
        session_id=session_id,
        role=role,
        content=content,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_output=tool_output,
        tool_error=tool_error,
        tool_call_id=tool_call_id,
        step_number=step_number,
        thinking_content=thinking_content,
        ui_spec=ui_spec,
    )
    db_session.add(message)

    # Update the session's updated_at timestamp
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    session = db_session.execute(stmt).scalar_one_or_none()
    if session:
        session.updated_at = datetime.utcnow()

    db_session.commit()
    db_session.refresh(message)
    return message


def add_tool_message(
    db_session: Session,
    session_id: UUID,
    tool_name: str,
    tool_input: dict[str, Any],
    tool_call_id: str,
    step_number: int,
    tool_output: dict[str, Any] | None = None,
    tool_error: str | None = None,
    ui_spec: dict[str, Any] | None = None,
) -> AgentMessage:
    """Create a tool message with tool_call_id and step_number."""
    return add_session_message(
        db_session=db_session,
        session_id=session_id,
        role=AgentMessageRole.TOOL,
        tool_name=tool_name,
        tool_input=tool_input,
        tool_output=tool_output,
        tool_error=tool_error,
        tool_call_id=tool_call_id,
        step_number=step_number,
        ui_spec=ui_spec,
    )


def update_tool_message_result(
    db_session: Session,
    session_id: UUID,
    tool_call_id: str,
    tool_output: dict[str, Any] | None = None,
    tool_error: str | None = None,
    ui_spec: dict[str, Any] | None = None,
) -> AgentMessage | None:
    """Update an existing tool message with its result after execution."""
    stmt = select(AgentMessage).where(
        AgentMessage.session_id == session_id,
        AgentMessage.tool_call_id == tool_call_id,
        AgentMessage.role == AgentMessageRole.TOOL,
    )
    message = db_session.execute(stmt).scalar_one_or_none()
    if message is None:
        return None

    if tool_output is not None:
        message.tool_output = tool_output
    if tool_error is not None:
        message.tool_error = tool_error
    if ui_spec is not None:
        message.ui_spec = ui_spec

    db_session.commit()
    db_session.refresh(message)
    return message


def update_message_ui_spec_artifact(
    db_session: Session,
    session_id: UUID,
    openui_lang: str,
    artifact_title: str,
) -> None:
    """Update the assistant message's ui_spec with artifact data.

    Finds the most recent assistant message for the given session,
    then merges an 'artifact' key into its ui_spec JSON.
    """
    stmt = (
        select(AgentMessage)
        .where(
            AgentMessage.session_id == session_id,
            AgentMessage.role == AgentMessageRole.ASSISTANT,
        )
        .order_by(desc(AgentMessage.created_at))
        .limit(1)
    )
    message = db_session.execute(stmt).scalar_one_or_none()
    if message is None:
        return

    ui_spec = message.ui_spec or {}
    ui_spec["artifact"] = {
        "openui_lang": openui_lang,
        "title": artifact_title,
    }
    message.ui_spec = ui_spec
    db_session.commit()


def update_session_status(
    db_session: Session,
    session_id: UUID,
    status: AgentSessionStatus,
) -> AgentSession | None:
    """Update the status of an agent session."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    session = db_session.execute(stmt).scalar_one_or_none()

    if session is None:
        return None

    session.status = status
    if status.is_terminal():
        session.completed_at = datetime.utcnow()

    db_session.commit()
    db_session.refresh(session)
    return session


def update_session_stats(
    db_session: Session,
    session_id: UUID,
    tokens_used: int = 0,
    tool_calls: int = 0,
) -> AgentSession | None:
    """Update the usage statistics for an agent session."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    session = db_session.execute(stmt).scalar_one_or_none()

    if session is None:
        return None

    session.total_tokens_used += tokens_used
    session.total_tool_calls += tool_calls

    db_session.commit()
    db_session.refresh(session)
    return session


def delete_session(
    db_session: Session,
    session_id: UUID,
    user_id: UUID | None,
) -> bool:
    """Delete an agent session and all its messages.

    Returns True if the session was deleted, False if not found or unauthorized.
    """
    stmt = select(AgentSession).where(AgentSession.id == session_id)

    # If user_id is provided, ensure the session belongs to that user
    if user_id is not None:
        stmt = stmt.where(AgentSession.user_id == user_id)

    session = db_session.execute(stmt).scalar_one_or_none()

    if session is None:
        return False

    # The cascade delete will handle messages automatically
    db_session.delete(session)
    db_session.commit()
    return True


def get_or_create_active_session(
    db_session: Session,
    user_id: UUID | None,
    workspace_path: str | None = None,
) -> AgentSession:
    """Return the most recent ACTIVE session for the user, creating one if none exists.

    Sub-sessions (SUB_ONE_SHOT, SUB_PERSISTENT) are excluded — they are
    background tasks, not the user's primary interactive session.
    """
    stmt = (
        select(AgentSession)
        .where(
            AgentSession.user_id == user_id,
            AgentSession.status == AgentSessionStatus.ACTIVE,
            AgentSession.session_type.notin_(["SUB_ONE_SHOT", "SUB_PERSISTENT"]),
        )
        .order_by(desc(AgentSession.updated_at))
        .limit(1)
    )
    session = db_session.execute(stmt).scalar_one_or_none()
    if session is not None:
        return session

    return create_session(
        db_session=db_session,
        user_id=user_id,
        workspace_path=workspace_path,
    )


def get_active_session_for_user(
    db_session: Session,
    user_id: UUID | None,
    exclude_session_id: UUID | None = None,
) -> AgentSession | None:
    """Return the most recent ACTIVE interactive session for the user, or None.

    Unlike get_or_create_active_session(), this never creates a new session.
    Sub-sessions are excluded. Use *exclude_session_id* to skip a known
    session (e.g. an inbox processing session that is still ACTIVE).
    """
    conditions = [
        AgentSession.user_id == user_id,
        AgentSession.status == AgentSessionStatus.ACTIVE,
        AgentSession.session_type.notin_(["SUB_ONE_SHOT", "SUB_PERSISTENT"]),
    ]
    if exclude_session_id is not None:
        conditions.append(AgentSession.id != exclude_session_id)
    stmt = (
        select(AgentSession)
        .where(*conditions)
        .order_by(desc(AgentSession.updated_at))
        .limit(1)
    )
    return db_session.execute(stmt).scalar_one_or_none()


def is_session_busy(
    redis_client: redis.Redis,  # type: ignore[type-arg]
    session_id: UUID,
) -> bool:
    """Check if a session is currently executing an interactive request.

    Returns True if the ``bud_agent_running:{session_id}`` key exists in Redis,
    meaning the interactive orchestrator is mid-execution.
    """
    key = f"bud_agent_running:{session_id}"
    return redis_client.exists(key) > 0


# --- Session execution status helpers ---

_STOP_FLAG_KEY_PREFIX = "bud_agent_stop"
_STOP_FLAG_TTL_SECONDS = 300


def set_session_execution_status(
    db_session: Session,
    session_id: UUID,
    status: AgentSessionExecutionStatus,
) -> None:
    """Update the real-time execution status of an agent session."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    session = db_session.execute(stmt).scalar_one_or_none()
    if session is None:
        raise ValueError(f"Agent session {session_id} not found")

    session.execution_status = status
    db_session.commit()


def get_session_execution_status(
    db_session: Session,
    session_id: UUID,
) -> AgentSessionExecutionStatus:
    """Get the current execution status of an agent session."""
    stmt = select(AgentSession.execution_status).where(
        AgentSession.id == session_id
    )
    result = db_session.execute(stmt).scalar_one_or_none()
    if result is None:
        raise ValueError(f"Agent session {session_id} not found")
    return result


def set_session_stop_flag(
    redis_client: redis.Redis,  # type: ignore[type-arg]
    session_id: UUID,
) -> None:
    """Set the stop flag for a session in Redis.

    The stop flag is stored in Redis (not the DB) because it needs to be
    checked frequently during LLM streaming without DB round-trip overhead.
    Key format: ``bud_agent_stop:{session_id}``
    """
    key = f"{_STOP_FLAG_KEY_PREFIX}:{session_id}"
    redis_client.set(key, "1", ex=_STOP_FLAG_TTL_SECONDS)


def is_session_stopped(
    redis_client: redis.Redis,  # type: ignore[type-arg]
    session_id: UUID,
) -> bool:
    """Check whether the stop flag is set for a session.

    Returns True if the ``bud_agent_stop:{session_id}`` key exists in Redis.
    """
    key = f"{_STOP_FLAG_KEY_PREFIX}:{session_id}"
    return redis_client.exists(key) > 0


def clear_session_stop_flag(
    redis_client: redis.Redis,  # type: ignore[type-arg]
    session_id: UUID,
) -> None:
    """Remove the stop flag for a session from Redis."""
    key = f"{_STOP_FLAG_KEY_PREFIX}:{session_id}"
    redis_client.delete(key)


def persist_pending_local_tools(
    db_session: Session,
    session_id: UUID,
    tools: list[dict[str, Any]],
) -> None:
    """Store a list of pending local tool calls on the session.

    These represent tool calls the LLM requested in parallel that still
    need to be dispatched to the client one at a time.
    """
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    session = db_session.execute(stmt).scalar_one_or_none()
    if session is None:
        raise ValueError(f"Agent session {session_id} not found")

    session.pending_local_tools = tools
    db_session.commit()


def load_pending_local_tools(
    db_session: Session,
    session_id: UUID,
) -> list[dict[str, Any]]:
    """Load the list of pending local tool calls for a session.

    Returns an empty list if no pending tools are stored.
    """
    stmt = select(AgentSession.pending_local_tools).where(
        AgentSession.id == session_id
    )
    result = db_session.execute(stmt).scalar_one_or_none()
    if result is None:
        return []
    return result


def tool_result_exists(
    db_session: Session,
    session_id: UUID,
    tool_call_id: str,
) -> bool:
    """Check whether a tool result has already been persisted for a given tool call.

    Used as an idempotency guard so duplicate ``tool:result`` messages
    from the client are silently ignored.

    Note: JSONB columns can hold JSON ``null`` which is different from
    SQL ``NULL``.  We must exclude both to avoid false positives for
    rows created with empty tool_output.
    """
    from sqlalchemy import cast, String

    stmt = exists(
        select(AgentMessage.id).where(
            AgentMessage.session_id == session_id,
            AgentMessage.tool_call_id == tool_call_id,
            AgentMessage.role == AgentMessageRole.TOOL,
            AgentMessage.tool_output.isnot(None),
            cast(AgentMessage.tool_output, String) != "null",
        )
    ).select()
    return db_session.execute(stmt).scalar() or False


def get_tool_message(
    db_session: Session,
    session_id: UUID,
    tool_call_id: str,
) -> AgentMessage | None:
    """Get a tool message by session_id and tool_call_id.

    Used to look up the tool name and input when an approval arrives so we
    can emit a ``tool:request`` for the approved tool.
    """
    stmt = select(AgentMessage).where(
        AgentMessage.session_id == session_id,
        AgentMessage.tool_call_id == tool_call_id,
        AgentMessage.role == AgentMessageRole.TOOL,
    )
    return db_session.execute(stmt).scalar_one_or_none()


def get_next_step_number(
    db_session: Session,
    session_id: UUID,
) -> int:
    """Return the next step number for a session.

    Finds the maximum step_number among existing messages and returns
    ``max + 1``.  Returns ``0`` if no messages exist yet.
    """
    from sqlalchemy import func as sa_func

    result = db_session.execute(
        select(sa_func.max(AgentMessage.step_number)).where(
            AgentMessage.session_id == session_id,
        )
    ).scalar()
    if result is None:
        return 0
    return result + 1


def create_compacted_session(
    db_session: Session,
    user_id: UUID | None,
    parent_session_id: UUID,
    compaction_summary: str,
    workspace_path: str | None = None,
) -> AgentSession:
    """Create a new ACTIVE session linked to a compacted parent session."""
    session = AgentSession(
        user_id=user_id,
        parent_session_id=parent_session_id,
        compaction_summary=compaction_summary,
        workspace_path=workspace_path,
        status=AgentSessionStatus.ACTIVE,
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session


def mark_session_compacted(
    db_session: Session,
    session_id: UUID,
) -> None:
    """Mark a session as COMPACTED and set its completed_at timestamp."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    session = db_session.execute(stmt).scalar_one_or_none()
    if session is not None:
        session.status = AgentSessionStatus.COMPACTED
        session.completed_at = datetime.utcnow()
        db_session.commit()


# --- Sub-session operations ---


def create_sub_session(
    db_session: Session,
    user_id: UUID | None,
    parent_session_id: UUID,
    task_description: str,
    task_context: str | None = None,
    session_type: str = "SUB_ONE_SHOT",
    max_context_tokens: int | None = None,
    max_turns: int | None = None,
    title: str | None = None,
    anchor_message_id: UUID | None = None,
) -> AgentSession:
    """Create a sub-session linked to a parent session.

    Unlike ``create_session()``, this does NOT deactivate existing
    ACTIVE sessions.  Sub-sessions run concurrently with (or are
    orchestrated by) their parent.
    """
    session = AgentSession(
        user_id=user_id,
        parent_session_id=parent_session_id,
        title=title or (task_description[:255] if task_description else None),
        description=task_context,
        task_description=task_description,
        session_type=session_type,
        max_context_tokens=max_context_tokens,
        max_turns=max_turns,
        anchor_message_id=anchor_message_id,
        status=AgentSessionStatus.ACTIVE,
    )
    db_session.add(session)
    db_session.commit()
    db_session.refresh(session)
    return session


def get_thread_for_message(
    db_session: Session,
    anchor_message_id: UUID,
) -> AgentSession | None:
    """Find an existing thread session anchored to a specific message."""
    stmt = (
        select(AgentSession)
        .where(AgentSession.anchor_message_id == anchor_message_id)
        .order_by(desc(AgentSession.created_at))
        .limit(1)
    )
    return db_session.execute(stmt).scalar_one_or_none()


def get_threads_for_session(
    db_session: Session,
    parent_session_id: UUID,
) -> dict[str, str]:
    """Return a map of anchor_message_id -> thread session_id for all threads in a parent session."""
    stmt = (
        select(AgentSession.anchor_message_id, AgentSession.id)
        .where(
            AgentSession.parent_session_id == parent_session_id,
            AgentSession.anchor_message_id.isnot(None),
        )
    )
    rows = db_session.execute(stmt).all()
    return {str(row[0]): str(row[1]) for row in rows}


def count_active_sub_sessions(
    db_session: Session,
    user_id: UUID,
) -> int:
    """Count ACTIVE sub-sessions for a user.

    Locks matching rows with ``FOR UPDATE`` to prevent race conditions
    when enforcing concurrency limits (design decision 0.1).

    PostgreSQL does not allow ``FOR UPDATE`` with aggregate functions,
    so we select the rows first (locking them), then count in Python.
    """
    stmt = (
        select(AgentSession.id)
        .where(
            AgentSession.user_id == user_id,
            AgentSession.session_type.in_(["SUB_ONE_SHOT", "SUB_PERSISTENT"]),
            AgentSession.status == AgentSessionStatus.ACTIVE,
        )
        .with_for_update()
    )
    rows = db_session.execute(stmt).all()
    return len(rows)


def get_sub_sessions_for_parent(
    db_session: Session,
    parent_session_id: UUID,
) -> list[AgentSession]:
    """Return all sub-sessions for a given parent, newest first."""
    stmt = (
        select(AgentSession)
        .where(AgentSession.parent_session_id == parent_session_id)
        .order_by(desc(AgentSession.created_at))
    )
    return list(db_session.execute(stmt).scalars().all())


def get_zombie_sub_sessions(
    db_session: Session,
    stale_minutes: int = 15,
) -> list[AgentSession]:
    """Return ACTIVE sub-sessions whose ``updated_at`` is older than *stale_minutes*.

    Used by the zombie reaper to detect sub-sessions that have stalled
    without a corresponding Redis heartbeat.
    """
    cutoff = datetime.utcnow() - timedelta(minutes=stale_minutes)
    stmt = (
        select(AgentSession)
        .where(
            AgentSession.session_type.in_(["SUB_ONE_SHOT", "SUB_PERSISTENT"]),
            AgentSession.status == AgentSessionStatus.ACTIVE,
            AgentSession.updated_at < cutoff,
        )
    )
    return list(db_session.execute(stmt).scalars().all())


def get_expired_persistent_sub_sessions(
    db_session: Session,
    expiry_seconds: int = 3600,
) -> list[AgentSession]:
    """Return SUB_PERSISTENT sessions that completed more than *expiry_seconds* ago.

    These are sessions whose ``completed_at + expiry_seconds < now()``.
    Used by the periodic expiry task to notify parents about expired
    persistent sub-sessions.
    """
    cutoff = datetime.utcnow() - timedelta(seconds=expiry_seconds)
    stmt = (
        select(AgentSession)
        .where(
            AgentSession.session_type == "SUB_PERSISTENT",
            AgentSession.status == AgentSessionStatus.COMPLETED,
            AgentSession.completed_at.isnot(None),
            AgentSession.completed_at < cutoff,
        )
    )
    return list(db_session.execute(stmt).scalars().all())


def repoint_sub_sessions_parent(
    db_session: Session,
    old_parent_id: UUID,
    new_parent_id: UUID,
) -> int:
    """Move ACTIVE sub-sessions from *old_parent_id* to *new_parent_id*.

    Used during compaction to keep sub-sessions attached to the
    current active session in the chain.  Returns the number of
    rows updated.
    """
    stmt = (
        update(AgentSession)
        .where(
            AgentSession.parent_session_id == old_parent_id,
            AgentSession.status == AgentSessionStatus.ACTIVE,
        )
        .values(parent_session_id=new_parent_id)
    )
    result = db_session.execute(stmt)
    db_session.commit()
    return result.rowcount  # type: ignore[return-value]


def update_session_title(
    db_session: Session,
    session_id: UUID,
    title: str,
    user_id: UUID | None = None,
) -> AgentSession | None:
    """Update the title of an agent session."""
    stmt = select(AgentSession).where(AgentSession.id == session_id)

    if user_id is not None:
        stmt = stmt.where(AgentSession.user_id == user_id)

    session = db_session.execute(stmt).scalar_one_or_none()

    if session is None:
        return None

    session.title = title
    db_session.commit()
    db_session.refresh(session)
    return session


# Memory operations


def create_memory(
    db_session: Session,
    user_id: UUID,
    content: str,
    source: AgentMemorySource,
    source_session_id: UUID | None = None,
) -> AgentMemory:
    """Create a new memory entry, deduplicating by content_hash."""
    import hashlib

    content_hash = hashlib.sha256(content.strip().encode("utf-8")).hexdigest()

    # Check for duplicate
    existing = db_session.execute(
        select(AgentMemory).where(
            AgentMemory.user_id == user_id,
            AgentMemory.content_hash == content_hash,
        )
    ).scalar_one_or_none()

    if existing is not None:
        # Update last_accessed_at and return existing
        existing.last_accessed_at = datetime.utcnow()
        db_session.commit()
        db_session.refresh(existing)
        return existing

    memory = AgentMemory(
        user_id=user_id,
        content=content.strip(),
        content_hash=content_hash,
        source=source,
        source_session_id=source_session_id,
    )
    db_session.add(memory)
    db_session.commit()
    db_session.refresh(memory)
    return memory


def search_memories_by_text(
    db_session: Session,
    user_id: UUID,
    query: str,
    limit: int = 5,
) -> list[AgentMemory]:
    """Search memories using PostgreSQL full-text search."""
    from sqlalchemy import func

    # Use PostgreSQL to_tsvector and ts_rank for full-text search
    ts_query = func.plainto_tsquery("english", query)
    ts_vector = func.to_tsvector("english", AgentMemory.content)
    rank = func.ts_rank(ts_vector, ts_query)

    stmt = (
        select(AgentMemory)
        .where(
            AgentMemory.user_id == user_id,
            ts_vector.op("@@")(ts_query),
        )
        .order_by(rank.desc())
        .limit(limit)
    )

    return list(db_session.execute(stmt).scalars().all())


def get_memories_for_user(
    db_session: Session,
    user_id: UUID,
    limit: int = 20,
    offset: int = 0,
) -> list[AgentMemory]:
    """Get memories for a user, ordered by most recently accessed."""
    stmt = (
        select(AgentMemory)
        .where(AgentMemory.user_id == user_id)
        .order_by(desc(AgentMemory.last_accessed_at.nulls_last()))
        .order_by(desc(AgentMemory.created_at))
        .offset(offset)
        .limit(limit)
    )
    return list(db_session.execute(stmt).scalars().all())


def delete_memory(
    db_session: Session,
    memory_id: UUID,
    user_id: UUID,
) -> bool:
    """Delete a memory, ensuring it belongs to the user."""
    stmt = select(AgentMemory).where(
        AgentMemory.id == memory_id,
        AgentMemory.user_id == user_id,
    )
    memory = db_session.execute(stmt).scalar_one_or_none()
    if memory is None:
        return False
    db_session.delete(memory)
    db_session.commit()
    return True


def update_memory_access(
    db_session: Session,
    memory_id: UUID,
) -> None:
    """Update the last_accessed_at timestamp for a memory."""
    stmt = select(AgentMemory).where(AgentMemory.id == memory_id)
    memory = db_session.execute(stmt).scalar_one_or_none()
    if memory is not None:
        memory.last_accessed_at = datetime.utcnow()
        db_session.commit()


# Workspace file operations


def upsert_workspace_file(
    db_session: Session,
    user_id: UUID,
    path: str,
    content: str,
) -> AgentWorkspaceFile:
    """Insert or update a workspace file by (user_id, path).

    Returns the created or updated file object.
    """
    stmt = select(AgentWorkspaceFile).where(
        AgentWorkspaceFile.user_id == user_id,
        AgentWorkspaceFile.path == path,
    )
    existing = db_session.execute(stmt).scalar_one_or_none()

    if existing is not None:
        existing.content = content
        existing.updated_at = datetime.utcnow()
        db_session.commit()
        db_session.refresh(existing)
        return existing

    workspace_file = AgentWorkspaceFile(
        user_id=user_id,
        path=path,
        content=content,
    )
    db_session.add(workspace_file)
    db_session.commit()
    db_session.refresh(workspace_file)
    return workspace_file


def get_workspace_file(
    db_session: Session,
    user_id: UUID,
    path: str,
) -> AgentWorkspaceFile | None:
    """Get a single workspace file by (user_id, path)."""
    stmt = select(AgentWorkspaceFile).where(
        AgentWorkspaceFile.user_id == user_id,
        AgentWorkspaceFile.path == path,
    )
    return db_session.execute(stmt).scalar_one_or_none()


def list_workspace_files(
    db_session: Session,
    user_id: UUID,
    prefix: str | None = None,
) -> list[AgentWorkspaceFile]:
    """List workspace files for a user, optionally filtered by path prefix.

    Results are ordered by path ascending.
    """
    stmt = select(AgentWorkspaceFile).where(
        AgentWorkspaceFile.user_id == user_id
    )

    if prefix is not None:
        stmt = stmt.where(AgentWorkspaceFile.path.startswith(prefix))

    stmt = stmt.order_by(AgentWorkspaceFile.path)
    return list(db_session.execute(stmt).scalars().all())


def delete_workspace_file(
    db_session: Session,
    user_id: UUID,
    path: str,
) -> bool:
    """Delete a workspace file. Returns True if found and deleted."""
    stmt = select(AgentWorkspaceFile).where(
        AgentWorkspaceFile.user_id == user_id,
        AgentWorkspaceFile.path == path,
    )
    workspace_file = db_session.execute(stmt).scalar_one_or_none()

    if workspace_file is None:
        return False

    db_session.delete(workspace_file)
    db_session.commit()
    return True


def get_workspace_files_as_dict(
    db_session: Session,
    user_id: UUID,
    paths: list[str] | None = None,
) -> dict[str, str]:
    """Return workspace files as a {path: content} dict.

    If paths is provided, only returns files matching those paths.
    If paths is None, returns all files for the user.
    """
    stmt = select(AgentWorkspaceFile).where(
        AgentWorkspaceFile.user_id == user_id
    )

    if paths is not None:
        stmt = stmt.where(AgentWorkspaceFile.path.in_(paths))

    files = db_session.execute(stmt).scalars().all()
    return {f.path: f.content for f in files}
