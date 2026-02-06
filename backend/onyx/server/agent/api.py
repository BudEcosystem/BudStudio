"""API endpoints for agent session management."""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from onyx.auth.users import current_user
from onyx.context.search.utils import get_query_embeddings
from onyx.db.agent import add_session_message
from onyx.db.agent import create_session
from onyx.db.agent import delete_session
from onyx.db.agent import get_session_for_user
from onyx.db.agent import get_session_messages
from onyx.db.agent import get_user_sessions
from onyx.db.agent import update_session_status
from onyx.db.agent import update_session_title
from onyx.db.engine.sql_engine import get_session
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import User
from onyx.utils.logger import setup_logger

logger = setup_logger()


router = APIRouter(prefix="/agent", tags=["Agent"])


# ==============================================================================
# Request/Response Models
# ==============================================================================


class CreateSessionRequest(BaseModel):
    title: str | None = None
    workspace_path: str | None = None


class CreateSessionResponse(BaseModel):
    session_id: str


class AddMessageRequest(BaseModel):
    role: str
    content: str | None = None
    tool_name: str | None = None
    tool_input: dict[str, Any] | None = None
    tool_output: dict[str, Any] | None = None
    tool_error: str | None = None


class AddMessageResponse(BaseModel):
    message_id: str


class UpdateSessionStatusRequest(BaseModel):
    status: str


class UpdateSessionTitleRequest(BaseModel):
    title: str


class AgentMessageSnapshot(BaseModel):
    id: str
    session_id: str
    role: str
    content: str | None
    tool_name: str | None
    tool_input: dict[str, Any] | None
    tool_output: dict[str, Any] | None
    tool_error: str | None
    created_at: datetime


class AgentSessionSnapshot(BaseModel):
    id: str
    user_id: str | None
    title: str | None
    description: str | None
    status: str
    workspace_path: str | None
    total_tokens_used: int
    total_tool_calls: int
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


class SessionListResponse(BaseModel):
    sessions: list[AgentSessionSnapshot]


class SessionHistoryResponse(BaseModel):
    messages: list[AgentMessageSnapshot]


class DeleteSessionResponse(BaseModel):
    status: str


class StatusResponse(BaseModel):
    status: str


class EmbedTextsRequest(BaseModel):
    """Request to embed one or more texts."""

    texts: list[str]


class EmbedTextsResponse(BaseModel):
    """Response containing embedding vectors."""

    embeddings: list[list[float]]


# ==============================================================================
# API Endpoints
# ==============================================================================


@router.post("/embed")
def embed_texts(
    request: EmbedTextsRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> EmbedTextsResponse:
    """Generate embeddings for one or more texts.

    Uses the currently configured embedding model (from search settings)
    to generate vector representations of the provided texts.

    This endpoint is intended for use by the agent memory system to
    generate embeddings for code chunks and search queries.
    """
    if not request.texts:
        raise HTTPException(status_code=400, detail="No texts provided")

    # Validate that all texts are non-empty
    if any(not text or not text.strip() for text in request.texts):
        raise HTTPException(status_code=400, detail="Empty texts are not allowed")

    # Limit the number of texts to prevent abuse
    max_texts = 100
    if len(request.texts) > max_texts:
        raise HTTPException(
            status_code=400,
            detail=f"Too many texts. Maximum allowed: {max_texts}",
        )

    try:
        embeddings = get_query_embeddings(request.texts, db_session)
        return EmbedTextsResponse(embeddings=embeddings)
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate embeddings: {str(e)}",
        )


@router.post("/sessions")
def create_agent_session(
    request: CreateSessionRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> CreateSessionResponse:
    """Create a new agent session for the current user."""
    user_id = user.id if user is not None else None

    session = create_session(
        db_session=db_session,
        user_id=user_id,
        title=request.title,
        workspace_path=request.workspace_path,
    )

    logger.info(f"Created agent session {session.id} for user {user_id}")

    return CreateSessionResponse(session_id=str(session.id))


@router.get("/sessions")
def list_agent_sessions(
    include_completed: bool = Query(default=True),
    limit: int | None = Query(default=None, le=100),
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> SessionListResponse:
    """List all agent sessions for the current user."""
    user_id = user.id if user is not None else None

    sessions = get_user_sessions(
        db_session=db_session,
        user_id=user_id,
        include_completed=include_completed,
        limit=limit,
    )

    return SessionListResponse(
        sessions=[
            AgentSessionSnapshot(
                id=str(s.id),
                user_id=str(s.user_id) if s.user_id else None,
                title=s.title,
                description=s.description,
                status=s.status.value,
                workspace_path=s.workspace_path,
                total_tokens_used=s.total_tokens_used,
                total_tool_calls=s.total_tool_calls,
                created_at=s.created_at,
                updated_at=s.updated_at,
                completed_at=s.completed_at,
            )
            for s in sessions
        ]
    )


@router.get("/sessions/{session_id}")
def get_agent_session(
    session_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> AgentSessionSnapshot:
    """Get details of a specific agent session."""
    user_id = user.id if user is not None else None

    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user_id,
    )

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return AgentSessionSnapshot(
        id=str(session.id),
        user_id=str(session.user_id) if session.user_id else None,
        title=session.title,
        description=session.description,
        status=session.status.value,
        workspace_path=session.workspace_path,
        total_tokens_used=session.total_tokens_used,
        total_tool_calls=session.total_tool_calls,
        created_at=session.created_at,
        updated_at=session.updated_at,
        completed_at=session.completed_at,
    )


@router.get("/sessions/{session_id}/history")
def get_session_history(
    session_id: UUID,
    limit: int | None = Query(default=None, le=1000),
    offset: int = Query(default=0, ge=0),
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> SessionHistoryResponse:
    """Get the message history for an agent session."""
    user_id = user.id if user is not None else None

    # First verify the session exists and belongs to the user
    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user_id,
    )

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = get_session_messages(
        db_session=db_session,
        session_id=session_id,
        limit=limit,
        offset=offset,
    )

    return SessionHistoryResponse(
        messages=[
            AgentMessageSnapshot(
                id=str(m.id),
                session_id=str(m.session_id),
                role=m.role.value,
                content=m.content,
                tool_name=m.tool_name,
                tool_input=m.tool_input,
                tool_output=m.tool_output,
                tool_error=m.tool_error,
                created_at=m.created_at,
            )
            for m in messages
        ]
    )


@router.post("/sessions/{session_id}/messages")
def add_message(
    session_id: UUID,
    request: AddMessageRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> AddMessageResponse:
    """Add a message to an agent session."""
    user_id = user.id if user is not None else None

    # First verify the session exists and belongs to the user
    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user_id,
    )

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Validate the role
    try:
        role = AgentMessageRole(request.role)
    except ValueError:
        valid_roles = [r.value for r in AgentMessageRole]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role '{request.role}'. Valid roles: {valid_roles}",
        )

    message = add_session_message(
        db_session=db_session,
        session_id=session_id,
        role=role,
        content=request.content,
        tool_name=request.tool_name,
        tool_input=request.tool_input,
        tool_output=request.tool_output,
        tool_error=request.tool_error,
    )

    return AddMessageResponse(message_id=str(message.id))


@router.patch("/sessions/{session_id}/status")
def update_status(
    session_id: UUID,
    request: UpdateSessionStatusRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Update the status of an agent session."""
    user_id = user.id if user is not None else None

    # First verify the session exists and belongs to the user
    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user_id,
    )

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Validate the status
    try:
        status = AgentSessionStatus(request.status)
    except ValueError:
        valid_statuses = [s.value for s in AgentSessionStatus]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status '{request.status}'. Valid statuses: {valid_statuses}",
        )

    updated_session = update_session_status(
        db_session=db_session,
        session_id=session_id,
        status=status,
    )

    if updated_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return StatusResponse(status=updated_session.status.value)


@router.patch("/sessions/{session_id}/title")
def update_title(
    session_id: UUID,
    request: UpdateSessionTitleRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> AgentSessionSnapshot:
    """Update the title of an agent session."""
    user_id = user.id if user is not None else None

    session = update_session_title(
        db_session=db_session,
        session_id=session_id,
        title=request.title,
        user_id=user_id,
    )

    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    return AgentSessionSnapshot(
        id=str(session.id),
        user_id=str(session.user_id) if session.user_id else None,
        title=session.title,
        description=session.description,
        status=session.status.value,
        workspace_path=session.workspace_path,
        total_tokens_used=session.total_tokens_used,
        total_tool_calls=session.total_tool_calls,
        created_at=session.created_at,
        updated_at=session.updated_at,
        completed_at=session.completed_at,
    )


@router.delete("/sessions/{session_id}")
def delete_agent_session(
    session_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> DeleteSessionResponse:
    """Delete an agent session and all its messages."""
    user_id = user.id if user is not None else None

    deleted = delete_session(
        db_session=db_session,
        session_id=session_id,
        user_id=user_id,
    )

    if not deleted:
        raise HTTPException(status_code=404, detail="Session not found")

    logger.info(f"Deleted agent session {session_id} for user {user_id}")

    return DeleteSessionResponse(status="deleted")
