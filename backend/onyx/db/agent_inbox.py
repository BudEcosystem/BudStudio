"""Database operations for agent inbox messaging (conversation-based).

All DB operations for the inbox system live here per CLAUDE.md guidelines.
"""

from datetime import datetime
from datetime import timezone
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy import case
from sqlalchemy import func
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from sqlalchemy.orm import Session

from onyx.db.enums import InboxAgentProcessingStatus
from onyx.db.enums import InboxGoalStatus
from onyx.db.enums import InboxSenderType
from onyx.db.models import InboxConversation
from onyx.db.models import InboxConversationParticipant
from onyx.db.models import InboxMessage
from onyx.db.models import User
from onyx.db.users import get_user_by_email
from onyx.utils.logger import setup_logger

logger = setup_logger()


def find_or_create_conversation(
    db_session: Session,
    user_a_id: UUID,
    user_b_id: UUID,
    goal: str = "General conversation",
) -> InboxConversation:
    """Find an existing 1:1 conversation between two users, or create one.

    Uses a subquery approach: find conversation_ids where user_a is a
    participant, intersect with conversation_ids where user_b is a
    participant, then filter to conversations with exactly 2 participants.
    """
    # Subquery: conversations that user_a participates in
    convos_a = (
        select(InboxConversationParticipant.conversation_id)
        .where(InboxConversationParticipant.user_id == user_a_id)
        .subquery()
    )

    # Subquery: conversations that user_b participates in
    convos_b = (
        select(InboxConversationParticipant.conversation_id)
        .where(InboxConversationParticipant.user_id == user_b_id)
        .subquery()
    )

    # Subquery: conversations with exactly 2 participants
    participant_count = (
        select(
            InboxConversationParticipant.conversation_id,
            func.count(InboxConversationParticipant.user_id).label("cnt"),
        )
        .group_by(InboxConversationParticipant.conversation_id)
        .having(func.count(InboxConversationParticipant.user_id) == 2)
        .subquery()
    )

    # Find conversation that is in all three sets
    stmt = (
        select(InboxConversation)
        .where(
            InboxConversation.id.in_(select(convos_a.c.conversation_id)),
            InboxConversation.id.in_(select(convos_b.c.conversation_id)),
            InboxConversation.id.in_(
                select(participant_count.c.conversation_id)
            ),
        )
        .limit(1)
    )

    existing = db_session.scalar(stmt)
    if existing is not None:
        return existing

    # Create new conversation with both participants
    conversation = InboxConversation(goal=goal)
    db_session.add(conversation)
    db_session.flush()  # Get the conversation ID

    participant_a = InboxConversationParticipant(
        conversation_id=conversation.id,
        user_id=user_a_id,
    )
    participant_b = InboxConversationParticipant(
        conversation_id=conversation.id,
        user_id=user_b_id,
    )
    db_session.add(participant_a)
    db_session.add(participant_b)
    db_session.commit()

    return conversation


def create_conversation(
    db_session: Session,
    user_a_id: UUID,
    user_b_id: UUID,
    goal: str = "General conversation",
) -> InboxConversation:
    """Always create a new 1:1 conversation between two users.

    Use this when starting a new topic/task so messages don't get mixed
    into an existing thread.
    """
    conversation = InboxConversation(goal=goal)
    db_session.add(conversation)
    db_session.flush()

    participant_a = InboxConversationParticipant(
        conversation_id=conversation.id,
        user_id=user_a_id,
    )
    participant_b = InboxConversationParticipant(
        conversation_id=conversation.id,
        user_id=user_b_id,
    )
    db_session.add(participant_a)
    db_session.add(participant_b)
    db_session.commit()

    return conversation


def add_message_to_conversation(
    db_session: Session,
    conversation_id: UUID,
    sender_user_id: UUID,
    sender_type: InboxSenderType,
    content: str,
    agent_processing_status: InboxAgentProcessingStatus | None = None,
) -> InboxMessage:
    """Create a new message in a conversation and bump updated_at."""
    message = InboxMessage(
        conversation_id=conversation_id,
        sender_user_id=sender_user_id,
        sender_type=sender_type,
        content=content,
        agent_processing_status=agent_processing_status,
    )
    db_session.add(message)

    # Bump the conversation's updated_at timestamp
    conversation = db_session.get(InboxConversation, conversation_id)
    if conversation is not None:
        conversation.updated_at = func.now()

    db_session.commit()
    return message


def list_conversations_for_user(
    db_session: Session,
    user_id: UUID,
    limit: int = 50,
) -> list[dict]:
    """List conversations for a user with preview info.

    Returns a list of dicts with: conversation_id, other_participant_name,
    other_participant_email, last_message_preview, last_message_at,
    unread_count. Ordered by last_message_at descending.
    """
    # Get all conversations the user participates in
    participant_rows = list(
        db_session.scalars(
            select(InboxConversationParticipant)
            .options(joinedload(InboxConversationParticipant.conversation))
            .where(InboxConversationParticipant.user_id == user_id)
            .order_by(InboxConversationParticipant.conversation_id)
        ).unique().all()
    )

    if not participant_rows:
        return []

    results: list[dict] = []
    for participant in participant_rows:
        convo_id = participant.conversation_id
        last_read_at = participant.last_read_at

        # Find the other participant
        other_participant = db_session.scalar(
            select(InboxConversationParticipant)
            .options(joinedload(InboxConversationParticipant.user))
            .where(
                and_(
                    InboxConversationParticipant.conversation_id == convo_id,
                    InboxConversationParticipant.user_id != user_id,
                )
            )
        )
        if other_participant is None:
            continue

        other_user = other_participant.user

        # Get the most recent message in this conversation
        latest_message = db_session.scalar(
            select(InboxMessage)
            .where(InboxMessage.conversation_id == convo_id)
            .order_by(InboxMessage.created_at.desc())
            .limit(1)
        )

        if latest_message is None:
            # Skip conversations with no messages
            continue

        # Count unread messages
        unread_filter = InboxMessage.conversation_id == convo_id
        if last_read_at is not None:
            unread_count = db_session.scalar(
                select(func.count(InboxMessage.id)).where(
                    and_(
                        unread_filter,
                        InboxMessage.created_at > last_read_at,
                    )
                )
            ) or 0
        else:
            # Never read — all messages are unread
            unread_count = db_session.scalar(
                select(func.count(InboxMessage.id)).where(unread_filter)
            ) or 0

        conversation = participant.conversation
        results.append(
            {
                "conversation_id": convo_id,
                "other_participant_name": other_user.personal_name
                if other_user
                else None,
                "other_participant_email": other_user.email
                if other_user
                else None,
                "last_message_preview": latest_message.content[:200],
                "last_message_at": latest_message.created_at,
                "unread_count": unread_count,
                "goal": conversation.goal if conversation else "",
                "goal_status": conversation.goal_status.value
                if conversation
                else "ACTIVE",
            }
        )

    # Sort by last_message_at descending and apply limit
    results.sort(
        key=lambda r: r["last_message_at"] or datetime.min.replace(
            tzinfo=timezone.utc
        ),
        reverse=True,
    )
    return results[:limit]


def get_conversation_messages(
    db_session: Session,
    conversation_id: UUID,
    limit: int = 100,
) -> list[InboxMessage]:
    """Get messages for a conversation ordered by created_at ASC."""
    return list(
        db_session.scalars(
            select(InboxMessage)
            .options(joinedload(InboxMessage.sender))
            .where(InboxMessage.conversation_id == conversation_id)
            .order_by(InboxMessage.created_at.asc())
            .limit(limit)
        ).unique().all()
    )


def mark_conversation_read(
    db_session: Session,
    user_id: UUID,
    conversation_id: UUID,
) -> None:
    """Mark a conversation as read for a user by updating last_read_at."""
    participant = db_session.scalar(
        select(InboxConversationParticipant).where(
            and_(
                InboxConversationParticipant.conversation_id == conversation_id,
                InboxConversationParticipant.user_id == user_id,
            )
        )
    )
    if participant is not None:
        participant.last_read_at = datetime.now(timezone.utc)
        db_session.commit()


def get_unread_count_for_user(
    db_session: Session,
    user_id: UUID,
) -> int:
    """Get total unread message count across all conversations for a user."""
    # Get all participant rows for this user
    participants = list(
        db_session.scalars(
            select(InboxConversationParticipant).where(
                InboxConversationParticipant.user_id == user_id
            )
        ).all()
    )

    if not participants:
        return 0

    total = 0
    for participant in participants:
        convo_id = participant.conversation_id
        last_read_at = participant.last_read_at

        if last_read_at is not None:
            count = db_session.scalar(
                select(func.count(InboxMessage.id)).where(
                    and_(
                        InboxMessage.conversation_id == convo_id,
                        InboxMessage.created_at > last_read_at,
                    )
                )
            ) or 0
        else:
            count = db_session.scalar(
                select(func.count(InboxMessage.id)).where(
                    InboxMessage.conversation_id == convo_id
                )
            ) or 0

        total += count

    return total


def count_consecutive_agent_messages(
    db_session: Session,
    conversation_id: UUID,
) -> int:
    """Count consecutive AGENT messages from the end of the conversation.

    Iterates from the most recent message backwards, counting while
    sender_type == AGENT. Stops at the first USER message.
    Returns 0 if the most recent message is from a USER or no messages exist.
    """
    messages = list(
        db_session.scalars(
            select(InboxMessage)
            .where(InboxMessage.conversation_id == conversation_id)
            .order_by(InboxMessage.created_at.desc())
        ).all()
    )

    count = 0
    for msg in messages:
        if msg.sender_type == InboxSenderType.AGENT:
            count += 1
        else:
            break

    return count


def update_message_processing_status(
    db_session: Session,
    message_id: UUID,
    status: InboxAgentProcessingStatus,
    result_summary: str | None = None,
    error_message: str | None = None,
    session_id: UUID | None = None,
    tokens_used: int | None = None,
) -> InboxMessage | None:
    """Update an inbox message's processing status and optional fields."""
    message = db_session.get(InboxMessage, message_id)
    if message is None:
        return None

    message.agent_processing_status = status
    if result_summary is not None:
        message.result_summary = result_summary
    if error_message is not None:
        message.error_message = error_message
    if session_id is not None:
        message.session_id = session_id
    if tokens_used is not None:
        message.tokens_used = tokens_used

    db_session.commit()
    return message


def get_unread_messages_for_context(
    db_session: Session,
    user_id: UUID,
    limit: int = 5,
) -> list[InboxMessage]:
    """Get recent unread messages across conversations for context building.

    Returns messages where:
    - The user is a participant in the conversation
    - The message was created after the user's last_read_at (or last_read_at
      is null, meaning all messages are unread)
    - The message was NOT sent by the user as USER type (excludes own messages)

    Ordered by created_at DESC, limited.
    Eager-loads sender relationship.
    """
    # Subquery: get (conversation_id, last_read_at) for this user
    participant_sub = (
        select(
            InboxConversationParticipant.conversation_id,
            InboxConversationParticipant.last_read_at,
        )
        .where(InboxConversationParticipant.user_id == user_id)
        .subquery()
    )

    # Join messages with participant info, filter to unread
    stmt = (
        select(InboxMessage)
        .join(
            participant_sub,
            InboxMessage.conversation_id == participant_sub.c.conversation_id,
        )
        .options(joinedload(InboxMessage.sender))
        .where(
            # Exclude messages sent by the user themselves as USER type
            ~and_(
                InboxMessage.sender_user_id == user_id,
                InboxMessage.sender_type == InboxSenderType.USER,
            ),
            # Unread: created_at > last_read_at, or last_read_at is null
            case(
                (
                    participant_sub.c.last_read_at.is_(None),
                    True,
                ),
                else_=(
                    InboxMessage.created_at > participant_sub.c.last_read_at
                ),
            ),
        )
        .order_by(InboxMessage.created_at.desc())
        .limit(limit)
    )

    return list(db_session.scalars(stmt).unique().all())


def update_conversation_goal_status(
    db_session: Session,
    conversation_id: UUID,
    status: InboxGoalStatus,
) -> InboxConversation | None:
    """Update the goal_status of a conversation."""
    conversation = db_session.get(InboxConversation, conversation_id)
    if conversation is None:
        return None
    conversation.goal_status = status
    db_session.commit()
    return conversation


def resolve_user(
    db_session: Session,
    identifier: str,
) -> tuple[User | None, str | None]:
    """Resolve a user by email or personal_name.

    Tries email lookup first (case-insensitive), then falls back to
    personal_name ilike match.

    Returns:
        (user, error) — user is set on success, error is set on failure
        or ambiguity.
    """
    # Try email first
    user = get_user_by_email(identifier, db_session)
    if user is not None:
        return user, None

    # Fall back to personal_name (case-insensitive exact match)
    # User model has lazy="joined" on oauth_accounts, so .unique() is required
    matches = list(
        db_session.scalars(
            select(User).where(
                func.lower(User.personal_name) == func.lower(identifier.strip())
            )
        ).unique().all()
    )

    if len(matches) == 1:
        return matches[0], None

    if len(matches) > 1:
        return None, (
            f"Multiple users match the name '{identifier}'. "
            "Please use their email address instead."
        )

    # Fall back to partial/prefix match on personal_name
    partial_matches = list(
        db_session.scalars(
            select(User).where(
                func.lower(User.personal_name).startswith(
                    func.lower(identifier.strip())
                )
            )
        ).unique().all()
    )

    if len(partial_matches) == 1:
        return partial_matches[0], None

    if len(partial_matches) > 1:
        return None, (
            f"Multiple users match '{identifier}'. "
            "Please use their email address instead."
        )

    return None, None
