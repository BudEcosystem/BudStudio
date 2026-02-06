"""Database operations for agent sessions and messages."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import desc
from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import AgentMessage
from onyx.db.models import AgentSession


def create_session(
    db_session: Session,
    user_id: UUID | None,
    title: str | None = None,
    workspace_path: str | None = None,
) -> AgentSession:
    """Create a new agent session for the user."""
    session = AgentSession(
        user_id=user_id,
        title=title,
        workspace_path=workspace_path,
        status=AgentSessionStatus.ACTIVE,
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
