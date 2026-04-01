"""REST API endpoints for agent sub-session management."""

from typing import Any
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.sub_session_tools import cancel_sub_session
from onyx.agents.bud_agent.sub_session_tools import get_sub_session_result
from onyx.agents.bud_agent.sub_session_tools import inspect_sub_session
from onyx.agents.bud_agent.sub_session_tools import list_sub_sessions
from onyx.agents.bud_agent.sub_session_tools import send_to_sub_session
from onyx.agents.bud_agent.sub_session_tools import spawn_sub_session
from onyx.auth.users import current_user
from onyx.db.agent import get_session_for_user
from onyx.db.agent import get_session_messages
from onyx.db.engine.sql_engine import get_session
from onyx.db.models import User
from onyx.utils.logger import setup_logger
from shared_configs.contextvars import get_current_tenant_id

logger = setup_logger()


router = APIRouter(prefix="/agent", tags=["Agent Sub-Sessions"])


# ==============================================================================
# Request/Response Models
# ==============================================================================


class SpinOffRequest(BaseModel):
    task: str
    task_context: str | None = None
    mode: str = "one_shot"
    max_turns: int | None = None


class FollowUpRequest(BaseModel):
    message: str


class CancelRequest(BaseModel):
    reason: str | None = None


class SubSessionSnapshot(BaseModel):
    session_id: str
    task: str
    task_name: str
    status: str
    session_type: str
    created_at: str
    tokens_used: int
    tool_calls: int
    turns: int | None


class SubSessionListResponse(BaseModel):
    sub_sessions: list[SubSessionSnapshot]


class SubSessionDetailResponse(BaseModel):
    session_id: str
    task: str
    status: str
    session_type: str
    created_at: str
    updated_at: str
    tokens_used: int
    tool_calls: int
    turns: int | None
    parent_session_id: str | None
    history: list[dict[str, Any]] | None = None


class SubSessionResultResponse(BaseModel):
    session_id: str
    status: str
    task: str
    summary: str
    tokens_used: int
    tool_calls: int


class SubSessionThreadMessage(BaseModel):
    role: str
    content: str
    tool_name: str | None = None
    created_at: str


class SubSessionThreadSession(BaseModel):
    session_id: str
    parent_session_id: str | None
    task: str
    task_name: str
    status: str
    session_type: str
    created_at: str
    completed_at: str | None = None
    turns_completed: int
    tokens_used: int
    tool_calls: int


class SubSessionThreadResponse(BaseModel):
    session_id: str
    task: str
    status: str
    session: SubSessionThreadSession | None = None
    messages: list[SubSessionThreadMessage]


class StatusResponse(BaseModel):
    status: str


# ==============================================================================
# API Endpoints
# ==============================================================================


@router.get("/sessions/{session_id}/sub-sessions")
def list_session_sub_sessions(
    session_id: UUID,
    status_filter: str | None = Query(default=None),
    limit: int = Query(default=20, le=50),
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> SubSessionListResponse:
    """List all sub-sessions spawned from a parent session."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Verify the parent session belongs to the user
    parent = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if parent is None:
        raise HTTPException(status_code=404, detail="Session not found")

    results = list_sub_sessions(
        db_session=db_session,
        parent_session_id=session_id,
        status_filter=status_filter,
        limit=limit,
    )

    return SubSessionListResponse(
        sub_sessions=[
            SubSessionSnapshot(
                session_id=str(r["session_id"]),
                task=str(r["task"]),
                task_name=str(r.get("task_name") or r["task"]),
                status=str(r["status"]),
                session_type=str(r["session_type"]),
                created_at=str(r["created_at"]),
                tokens_used=int(r.get("tokens_used", 0) or 0),
                tool_calls=int(r.get("tool_calls", 0) or 0),
                turns=r.get("turns") if r.get("turns") is not None else None,  # type: ignore[arg-type]
            )
            for r in results
        ]
    )


@router.get("/sessions/{session_id}/thread")
def get_sub_session_thread(
    session_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> SubSessionThreadResponse:
    """Get the message thread for a sub-session.

    Returns all messages in the sub-session for review.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    messages = get_session_messages(db_session=db_session, session_id=session_id)

    thread_messages: list[SubSessionThreadMessage] = []
    for m in messages:
        thread_messages.append(
            SubSessionThreadMessage(
                role=m.role.value,
                content=m.content or "",
                tool_name=m.tool_name,
                created_at=m.created_at.isoformat() if m.created_at else "",
            )
        )

    return SubSessionThreadResponse(
        session_id=str(session.id),
        task=session.task_description or "",
        status=session.status.value,
        session=SubSessionThreadSession(
            session_id=str(session.id),
            parent_session_id=str(session.parent_session_id) if session.parent_session_id else None,
            task=session.task_description or "",
            task_name=session.title or session.task_description or "",
            status=session.status.value,
            session_type=session.session_type or "SUB_ONE_SHOT",
            created_at=session.created_at.isoformat() if session.created_at else "",
            completed_at=session.completed_at.isoformat() if session.completed_at else None,
            turns_completed=session.max_turns or 0,
            tokens_used=session.total_tokens_used,
            tool_calls=session.total_tool_calls,
        ),
        messages=thread_messages,
    )


@router.post("/sessions/{session_id}/spin-off")
def spin_off_sub_session(
    session_id: UUID,
    request: SpinOffRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, object]:
    """Spawn a new sub-session from an existing parent session.

    This is the REST equivalent of the spawn_sub_session tool.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Verify the parent session belongs to the user
    parent = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if parent is None:
        raise HTTPException(status_code=404, detail="Session not found")

    tenant_id = get_current_tenant_id()

    result = spawn_sub_session(
        db_session=db_session,
        user_id=user.id,
        parent_session_id=session_id,
        task=request.task,
        task_context=request.task_context,
        mode=request.mode,
        max_turns=request.max_turns,
        tenant_id=tenant_id,
    )

    if result.get("status") == "rejected":
        raise HTTPException(
            status_code=429,
            detail=f"Concurrency limit reached: {result.get('active_count')}/{result.get('limit')} active sub-sessions",
        )

    return result


@router.post("/sessions/{session_id}/cancel")
def cancel_session(
    session_id: UUID,
    request: CancelRequest | None = None,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, object]:
    """Cancel a running sub-session."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    tenant_id = get_current_tenant_id()
    reason: str | None = request.reason if request else None

    result = cancel_sub_session(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
        reason=reason,
        tenant_id=tenant_id,
    )

    if "error" in result:
        raise HTTPException(status_code=404, detail=str(result["error"]))

    return result


@router.post("/sessions/{session_id}/followup")
def send_followup(
    session_id: UUID,
    request: FollowUpRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, object]:
    """Send a message to a sub-session."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not request.message or not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    tenant_id = get_current_tenant_id()

    result = send_to_sub_session(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
        message=request.message,
        tenant_id=tenant_id,
    )

    if "error" in result:
        raise HTTPException(status_code=400, detail=str(result["error"]))

    # Handle session_expired as a 410 Gone response
    if result.get("reason") == "session_expired":
        raise HTTPException(status_code=410, detail=str(result.get("message", "Session expired")))

    return result
