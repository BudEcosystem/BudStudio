"""API endpoints for agent session management."""

import json
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from onyx.agents.bud_agent.orchestrator import BudAgentOrchestrator
from onyx.agents.bud_agent.packet_utils import translate_agent_messages_to_packets
from onyx.auth.users import current_user
from onyx.context.search.utils import get_query_embeddings
from onyx.db.agent import add_session_message
from onyx.db.agent import create_session
from onyx.db.agent import delete_session
from onyx.db.agent import get_or_create_active_session
from onyx.db.agent import get_session_for_user
from onyx.db.agent import get_session_messages
from onyx.db.agent import get_user_sessions
from onyx.db.agent import create_memory
from onyx.db.agent import delete_memory
from onyx.db.agent import delete_workspace_file
from onyx.db.agent import get_memories_for_user
from onyx.db.agent import get_workspace_file
from onyx.db.agent import list_workspace_files
from onyx.db.agent import update_session_status
from onyx.db.agent import update_session_title
from onyx.db.agent import upsert_workspace_file
from onyx.db.engine.sql_engine import get_session
from onyx.db.enums import AgentMemorySource
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import AgentSessionStatus
from onyx.db.models import User
from onyx.redis.redis_pool import get_redis_client
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
    tool_call_id: str | None = None
    step_number: int | None = None
    thinking_content: str | None = None
    ui_spec: dict[str, Any] | None = None
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
    parent_session_id: str | None = None
    compaction_summary: str | None = None


class SessionListResponse(BaseModel):
    sessions: list[AgentSessionSnapshot]


class PacketResponse(BaseModel):
    """Serializable representation of a Packet for JSON API responses."""
    ind: int
    obj: dict[str, Any]


class SessionHistoryResponse(BaseModel):
    messages: list[AgentMessageSnapshot]
    packets: list[list[PacketResponse]]


class DeleteSessionResponse(BaseModel):
    status: str


class StatusResponse(BaseModel):
    status: str


class CreateMemoryRequest(BaseModel):
    content: str


class MemorySnapshot(BaseModel):
    id: str
    content: str
    source: str
    created_at: datetime
    last_accessed_at: datetime | None


class MemoryListResponse(BaseModel):
    memories: list[MemorySnapshot]


class EmbedTextsRequest(BaseModel):
    """Request to embed one or more texts."""

    texts: list[str]


class EmbedTextsResponse(BaseModel):
    """Response containing embedding vectors."""

    embeddings: list[list[float]]


class WorkspaceFileSnapshot(BaseModel):
    path: str
    content: str
    created_at: datetime
    updated_at: datetime


class WorkspaceFileListResponse(BaseModel):
    files: list[WorkspaceFileSnapshot]


class UpsertWorkspaceFileRequest(BaseModel):
    path: str
    content: str


class ExecuteAgentRequest(BaseModel):
    message: str
    workspace_path: str | None = None
    model: str | None = None
    timezone: str | None = None


class ToolResultRequest(BaseModel):
    tool_call_id: str
    output: str | None = None
    error: str | None = None


class ApprovalRequest(BaseModel):
    tool_call_id: str
    approved: bool


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


def _session_to_snapshot(s: Any) -> AgentSessionSnapshot:
    """Convert an AgentSession ORM object to an AgentSessionSnapshot."""
    return AgentSessionSnapshot(
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
        parent_session_id=str(s.parent_session_id) if s.parent_session_id else None,
        compaction_summary=s.compaction_summary,
    )


@router.get("/active-session")
def get_active_session(
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> AgentSessionSnapshot:
    """Return the single active session for the current user, auto-creating if needed."""
    user_id = user.id if user is not None else None

    session = get_or_create_active_session(
        db_session=db_session,
        user_id=user_id,
    )

    return _session_to_snapshot(session)


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
        sessions=[_session_to_snapshot(s) for s in sessions]
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

    return _session_to_snapshot(session)


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

    # Reconstruct packets from messages
    packet_turns = translate_agent_messages_to_packets(messages)
    serialized_packets: list[list[PacketResponse]] = []
    for turn in packet_turns:
        serialized_turn: list[PacketResponse] = []
        for pkt in turn:
            serialized_turn.append(
                PacketResponse(
                    ind=pkt.ind,
                    obj=pkt.obj.model_dump(mode="json", exclude_none=True),
                )
            )
        serialized_packets.append(serialized_turn)

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
                tool_call_id=getattr(m, "tool_call_id", None),
                step_number=getattr(m, "step_number", None),
                thinking_content=getattr(m, "thinking_content", None),
                ui_spec=getattr(m, "ui_spec", None),
                created_at=m.created_at,
            )
            for m in messages
        ],
        packets=serialized_packets,
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


# ==============================================================================
# Memory Endpoints
# ==============================================================================


@router.get("/memories")
def list_memories(
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> MemoryListResponse:
    """List memories for the current user."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    memories = get_memories_for_user(
        db_session=db_session,
        user_id=user.id,
        limit=limit,
        offset=offset,
    )

    return MemoryListResponse(
        memories=[
            MemorySnapshot(
                id=str(m.id),
                content=m.content,
                source=m.source.value if m.source else "unknown",
                created_at=m.created_at,
                last_accessed_at=m.last_accessed_at,
            )
            for m in memories
        ]
    )


@router.post("/memories")
def create_agent_memory(
    request: CreateMemoryRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> MemorySnapshot:
    """Create a new memory for the current user."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not request.content or not request.content.strip():
        raise HTTPException(status_code=400, detail="Memory content cannot be empty")

    memory = create_memory(
        db_session=db_session,
        user_id=user.id,
        content=request.content,
        source=AgentMemorySource.USER_INPUT,
    )

    return MemorySnapshot(
        id=str(memory.id),
        content=memory.content,
        source=memory.source.value if memory.source else "unknown",
        created_at=memory.created_at,
        last_accessed_at=memory.last_accessed_at,
    )


@router.delete("/memories/{memory_id}")
def delete_agent_memory(
    memory_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Delete a specific memory."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    deleted = delete_memory(
        db_session=db_session,
        memory_id=memory_id,
        user_id=user.id,
    )

    if not deleted:
        raise HTTPException(status_code=404, detail="Memory not found")

    return StatusResponse(status="deleted")


# ==============================================================================
# Workspace File Endpoints
# ==============================================================================


@router.get("/workspace-files")
def list_agent_workspace_files(
    prefix: str | None = Query(default=None),
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> WorkspaceFileListResponse:
    """List workspace files for the current user, optionally filtered by prefix."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    files = list_workspace_files(
        db_session=db_session,
        user_id=user.id,
        prefix=prefix,
    )

    return WorkspaceFileListResponse(
        files=[
            WorkspaceFileSnapshot(
                path=f.path,
                content=f.content,
                created_at=f.created_at,
                updated_at=f.updated_at,
            )
            for f in files
        ]
    )


@router.get("/workspace-files/{path:path}")
def get_agent_workspace_file(
    path: str,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> WorkspaceFileSnapshot:
    """Read a specific workspace file by path."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    workspace_file = get_workspace_file(
        db_session=db_session,
        user_id=user.id,
        path=path,
    )

    if workspace_file is None:
        raise HTTPException(status_code=404, detail="Workspace file not found")

    return WorkspaceFileSnapshot(
        path=workspace_file.path,
        content=workspace_file.content,
        created_at=workspace_file.created_at,
        updated_at=workspace_file.updated_at,
    )


@router.put("/workspace-files")
def upsert_agent_workspace_file(
    request: UpsertWorkspaceFileRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> WorkspaceFileSnapshot:
    """Create or update a workspace file."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    if not request.path or not request.path.strip():
        raise HTTPException(status_code=400, detail="Path cannot be empty")

    workspace_file = upsert_workspace_file(
        db_session=db_session,
        user_id=user.id,
        path=request.path.strip(),
        content=request.content,
    )

    return WorkspaceFileSnapshot(
        path=workspace_file.path,
        content=workspace_file.content,
        created_at=workspace_file.created_at,
        updated_at=workspace_file.updated_at,
    )


@router.delete("/workspace-files/{path:path}")
def delete_agent_workspace_file(
    path: str,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Delete a workspace file."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    deleted = delete_workspace_file(
        db_session=db_session,
        user_id=user.id,
        path=path,
    )

    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace file not found")

    return StatusResponse(status="deleted")


# ==============================================================================
# Agent Execution Endpoints
# ==============================================================================


@router.post("/sessions/{session_id}/execute")
def execute_agent(
    session_id: UUID,
    request: ExecuteAgentRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StreamingResponse:
    """Execute the agent for a session, streaming results via SSE."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    redis_client = get_redis_client()

    orchestrator = BudAgentOrchestrator(
        session_id=session_id,
        user=user,
        db_session=db_session,
        redis_client=redis_client,
        workspace_path=request.workspace_path or session.workspace_path,
        model=request.model,
        timezone=request.timezone,
    )

    return StreamingResponse(
        orchestrator.run(request.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/sessions/{session_id}/tool-result")
def submit_tool_result(
    session_id: UUID,
    request: ToolResultRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Submit a tool execution result from the desktop."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status.is_terminal():
        raise HTTPException(
            status_code=409,
            detail="Session is no longer active",
        )

    redis_client = get_redis_client()

    key = f"bud_agent_tool_result:{session_id}:{request.tool_call_id}"
    payload = json.dumps({
        "output": request.output,
        "error": request.error,
    })
    redis_client.rpush(key, payload)
    redis_client.expire(key, 600)  # 10-minute TTL

    return StatusResponse(status="submitted")


@router.post("/sessions/{session_id}/approval")
def submit_approval(
    session_id: UUID,
    request: ApprovalRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Submit a tool approval decision from the user."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.status.is_terminal():
        raise HTTPException(
            status_code=409,
            detail="Session is no longer active",
        )

    redis_client = get_redis_client()

    key = f"bud_agent_approval:{session_id}:{request.tool_call_id}"
    payload = json.dumps({"approved": request.approved})
    redis_client.rpush(key, payload)
    redis_client.expire(key, 600)

    return StatusResponse(status="submitted")


@router.post("/sessions/{session_id}/stop")
def stop_agent(
    session_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Stop a running agent execution."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    session = get_session_for_user(
        db_session=db_session,
        session_id=session_id,
        user_id=user.id,
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    redis_client = get_redis_client()

    # Set stop signal that the orchestrator checks periodically
    redis_client.set(f"bud_agent_stop:{session_id}", "1", ex=300)

    return StatusResponse(status="stopping")
