"""API endpoints for agent inbox messaging (conversation-based)."""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy import and_
from sqlalchemy import select
from sqlalchemy.orm import Session

from onyx.auth.users import current_user
from onyx.configs.constants import INBOX_AGENT_SAFETY_CAP
from onyx.configs.constants import OnyxCeleryPriority
from onyx.configs.constants import OnyxCeleryQueues
from onyx.configs.constants import OnyxCeleryTask
from onyx.db.agent_inbox import add_message_to_conversation
from onyx.db.agent_inbox import count_consecutive_agent_messages
from onyx.db.agent_inbox import create_conversation
from onyx.db.agent_inbox import get_conversation_messages
from onyx.db.agent_inbox import get_unread_count_for_user
from onyx.db.agent_inbox import list_conversations_for_user
from onyx.db.agent_inbox import mark_conversation_read
from onyx.db.agent_inbox import resolve_user
from onyx.db.engine.sql_engine import get_session
from onyx.db.enums import InboxAgentProcessingStatus
from onyx.db.enums import InboxSenderType
from onyx.db.models import InboxConversationParticipant
from onyx.db.models import InboxMessage
from onyx.db.models import User
from onyx.utils.logger import setup_logger
from shared_configs.contextvars import get_current_tenant_id

logger = setup_logger()

router = APIRouter(prefix="/agent/inbox", tags=["Agent Inbox"])


# ==============================================================================
# Request/Response Models
# ==============================================================================


class InboxMessageSnapshot(BaseModel):
    id: str
    conversation_id: str
    sender_user_id: str
    sender_name: str | None
    sender_email: str | None
    sender_type: str
    content: str
    agent_processing_status: str | None
    result_summary: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class ConversationListItem(BaseModel):
    conversation_id: str
    other_participant_name: str | None
    other_participant_email: str | None
    last_message_preview: str | None
    last_message_at: datetime | None
    unread_count: int


class ConversationDetailResponse(BaseModel):
    conversation_id: str
    participants: list[dict]
    messages: list[InboxMessageSnapshot]


class SendMessageRequest(BaseModel):
    recipient: str
    message: str


class ReplyRequest(BaseModel):
    message_text: str


class InboxSettingsRequest(BaseModel):
    auto_reply_enabled: bool
    reply_depth_limit: int | None


class InboxSettingsResponse(BaseModel):
    auto_reply_enabled: bool
    reply_depth_limit: int | None


# ==============================================================================
# Helpers
# ==============================================================================


def _message_to_snapshot(msg: InboxMessage) -> InboxMessageSnapshot:
    sender_name: str | None = None
    sender_email: str | None = None
    if msg.sender:
        sender_name = msg.sender.personal_name
        sender_email = msg.sender.email

    return InboxMessageSnapshot(
        id=str(msg.id),
        conversation_id=str(msg.conversation_id),
        sender_user_id=str(msg.sender_user_id),
        sender_name=sender_name,
        sender_email=sender_email,
        sender_type=(
            msg.sender_type.value
            if hasattr(msg.sender_type, "value")
            else str(msg.sender_type)
        ),
        content=msg.content,
        agent_processing_status=(
            msg.agent_processing_status.value
            if msg.agent_processing_status
            and hasattr(msg.agent_processing_status, "value")
            else (
                str(msg.agent_processing_status)
                if msg.agent_processing_status
                else None
            )
        ),
        result_summary=msg.result_summary,
        error_message=msg.error_message,
        created_at=msg.created_at,
        updated_at=msg.updated_at,
    )


def _verify_user_is_participant(
    db_session: Session,
    user_id: UUID,
    conversation_id: UUID,
) -> None:
    """Raise 404 if the user is not a participant in the conversation."""
    participant = db_session.scalar(
        select(InboxConversationParticipant).where(
            and_(
                InboxConversationParticipant.conversation_id == conversation_id,
                InboxConversationParticipant.user_id == user_id,
            )
        )
    )
    if participant is None:
        raise HTTPException(status_code=404, detail="Conversation not found")


def _get_other_participant_user(
    db_session: Session,
    user_id: UUID,
    conversation_id: UUID,
) -> User | None:
    """Return the other participant's User object in a 1:1 conversation."""
    from sqlalchemy.orm import joinedload

    other = db_session.scalar(
        select(InboxConversationParticipant)
        .options(joinedload(InboxConversationParticipant.user))
        .where(
            and_(
                InboxConversationParticipant.conversation_id == conversation_id,
                InboxConversationParticipant.user_id != user_id,
            )
        )
    )
    if other is None:
        return None
    return other.user


def _maybe_dispatch_processing(
    db_session: Session,
    message: InboxMessage,
    receiver: User,
    tenant_id: str = "public",
) -> None:
    """Dispatch Celery task if receiver has auto-reply enabled and safety cap
    not reached."""
    if not receiver.inbox_auto_reply_enabled:
        return

    consecutive = count_consecutive_agent_messages(
        db_session, message.conversation_id
    )
    if consecutive >= INBOX_AGENT_SAFETY_CAP:
        logger.info(
            "Inbox safety cap reached (%d/%d) for conversation %s — skipping dispatch",
            consecutive,
            INBOX_AGENT_SAFETY_CAP,
            message.conversation_id,
        )
        return

    try:
        from onyx.background.celery.apps.client import celery_app

        celery_app.send_task(
            OnyxCeleryTask.PROCESS_INBOX_MESSAGE,
            kwargs={
                "message_id": str(message.id),
                "tenant_id": tenant_id,
                "target_user_id": str(receiver.id),
            },
            queue=OnyxCeleryQueues.PRIMARY,
            priority=OnyxCeleryPriority.HIGH,
        )
    except Exception:
        logger.warning(
            "Failed to dispatch inbox message processing task", exc_info=True
        )


# ==============================================================================
# Endpoints
# ==============================================================================


@router.get("/conversations")
def list_conversations(
    limit: int = 50,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> list[ConversationListItem]:
    """List all conversations for the current user, ordered by most recent
    message."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    rows = list_conversations_for_user(db_session, user.id, limit=limit)
    return [
        ConversationListItem(
            conversation_id=str(row["conversation_id"]),
            other_participant_name=row["other_participant_name"],
            other_participant_email=row["other_participant_email"],
            last_message_preview=row["last_message_preview"],
            last_message_at=row["last_message_at"],
            unread_count=row["unread_count"],
        )
        for row in rows
    ]


@router.get("/conversations/{conversation_id}")
def get_conversation(
    conversation_id: UUID,
    limit: int = 100,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> ConversationDetailResponse:
    """Get full conversation detail including participants and messages."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    _verify_user_is_participant(db_session, user.id, conversation_id)

    # Load participants
    from sqlalchemy.orm import joinedload

    participants_rows = list(
        db_session.scalars(
            select(InboxConversationParticipant)
            .options(joinedload(InboxConversationParticipant.user))
            .where(
                InboxConversationParticipant.conversation_id == conversation_id
            )
        )
        .unique()
        .all()
    )
    participants: list[dict] = []
    for p in participants_rows:
        participant_info: dict[str, str | None] = {
            "user_id": str(p.user_id),
            "name": p.user.personal_name if p.user else None,
            "email": p.user.email if p.user else None,
        }
        participants.append(participant_info)

    # Load messages
    messages = get_conversation_messages(
        db_session, conversation_id, limit=limit
    )

    return ConversationDetailResponse(
        conversation_id=str(conversation_id),
        participants=participants,
        messages=[_message_to_snapshot(m) for m in messages],
    )


@router.post("/conversations/{conversation_id}/read")
def read_conversation(
    conversation_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, str]:
    """Mark all messages in a conversation as read for the current user."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    _verify_user_is_participant(db_session, user.id, conversation_id)
    mark_conversation_read(db_session, user.id, conversation_id)

    return {"status": "ok"}


@router.post("/conversations/{conversation_id}/reply")
def reply_to_conversation(
    conversation_id: UUID,
    request: ReplyRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> InboxMessageSnapshot:
    """Reply to an existing conversation. The current user sends a message."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    _verify_user_is_participant(db_session, user.id, conversation_id)

    message = add_message_to_conversation(
        db_session=db_session,
        conversation_id=conversation_id,
        sender_user_id=user.id,
        sender_type=InboxSenderType.USER,
        content=request.message_text,
        agent_processing_status=InboxAgentProcessingStatus.PENDING,
    )

    tenant_id = get_current_tenant_id()

    # Dispatch to BOTH agents — each independently decides what to do.
    # The sender's agent sees it as a direct instruction from their user.
    # The other participant's agent sees it as an incoming message.
    other_user = _get_other_participant_user(
        db_session, user.id, conversation_id
    )
    if other_user is not None:
        _maybe_dispatch_processing(
            db_session, message, other_user, tenant_id=tenant_id
        )

    # Also dispatch to the sender's own agent
    db_user = db_session.get(User, user.id)
    if db_user is not None:
        _maybe_dispatch_processing(
            db_session, message, db_user, tenant_id=tenant_id
        )

    return _message_to_snapshot(message)


@router.post("/send")
def send_message(
    request: SendMessageRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> InboxMessageSnapshot:
    """Send a new message to a user (by email or name). Creates a conversation
    if one does not already exist between the two users."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    recipient_user, error = resolve_user(db_session, request.recipient)
    if error is not None:
        raise HTTPException(status_code=400, detail=error)
    if recipient_user is None:
        raise HTTPException(
            status_code=404,
            detail=f"User not found: {request.recipient}",
        )

    if recipient_user.id == user.id:
        raise HTTPException(
            status_code=400,
            detail="Cannot send a message to yourself",
        )

    conversation = create_conversation(
        db_session, user.id, recipient_user.id
    )

    message = add_message_to_conversation(
        db_session=db_session,
        conversation_id=conversation.id,
        sender_user_id=user.id,
        sender_type=InboxSenderType.USER,
        content=request.message,
        agent_processing_status=InboxAgentProcessingStatus.PENDING,
    )

    tenant_id = get_current_tenant_id()
    _maybe_dispatch_processing(
        db_session, message, recipient_user, tenant_id=tenant_id
    )

    return _message_to_snapshot(message)


@router.get("/unread-count")
def get_unread_count(
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> dict[str, int]:
    """Get the total unread message count across all conversations."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    count = get_unread_count_for_user(db_session, user.id)
    return {"unread_count": count}


@router.get("/settings")
def get_settings(
    user: User | None = Depends(current_user),
) -> InboxSettingsResponse:
    """Get the current user's inbox auto-reply settings."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    return InboxSettingsResponse(
        auto_reply_enabled=user.inbox_auto_reply_enabled,
        reply_depth_limit=user.inbox_reply_depth_limit,
    )


@router.put("/settings")
def update_settings(
    request: InboxSettingsRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> InboxSettingsResponse:
    """Update the current user's inbox auto-reply settings."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    # Re-fetch user from this session so changes are tracked
    db_user = db_session.get(User, user.id)
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")

    db_user.inbox_auto_reply_enabled = request.auto_reply_enabled
    db_user.inbox_reply_depth_limit = request.reply_depth_limit
    db_session.commit()

    return InboxSettingsResponse(
        auto_reply_enabled=db_user.inbox_auto_reply_enabled,
        reply_depth_limit=db_user.inbox_reply_depth_limit,
    )
