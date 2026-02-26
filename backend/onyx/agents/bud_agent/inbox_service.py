"""Inbox messaging service for BudAgent.

Provides Agents SDK FunctionTool objects for the ``send_message`` tool so
the agent can send messages to other users' agents during conversation.

All DB operations are delegated to ``onyx.db.agent_inbox``.
"""

import json
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.configs.constants import INBOX_AGENT_SAFETY_CAP
from onyx.configs.constants import OnyxCeleryPriority
from onyx.configs.constants import OnyxCeleryQueues
from onyx.configs.constants import OnyxCeleryTask
from onyx.db.agent_inbox import add_message_to_conversation
from onyx.db.agent_inbox import count_consecutive_agent_messages
from onyx.db.agent_inbox import create_conversation
from onyx.db.agent_inbox import get_conversation_messages
from onyx.db.agent_inbox import resolve_user
from onyx.db.enums import InboxSenderType
from onyx.db.models import User
from onyx.redis.event_publisher import publish_event
from onyx.utils.logger import setup_logger

logger = setup_logger()


def _get_sender_display_name(
    db_session: Session, user_id: UUID
) -> str | None:
    """Return a human-readable display name for the given user, or None."""
    user = db_session.get(User, user_id)
    if user is None:
        return None
    return user.personal_name or user.email


def create_inbox_tools(
    db_session: Session,
    user_id: UUID,
    tenant_id: str,
) -> list[Any]:
    from agents import FunctionTool
    from agents import RunContextWrapper
    from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS

    schema = REMOTE_TOOL_SCHEMAS["send_message"]

    async def _handle_send_message(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            recipient_str = args.get("recipient", "").strip()
            message_text = args.get("message", "").strip()
            conversation_id_str = args.get("conversation_id", "").strip()

            if not recipient_str:
                return "Error: 'recipient' is required."
            if not message_text:
                return "Error: 'message' is required."

            # Resolve recipient
            recipient, resolve_error = resolve_user(db_session, recipient_str)
            if resolve_error:
                return f"Error: {resolve_error}"
            if recipient is None:
                return (
                    f"Error: Could not find user '{recipient_str}'. "
                    "Please check the email address or name and try again."
                )

            # Prevent sending to self
            if recipient.id == user_id:
                return "Error: You cannot send a message to yourself."

            # If conversation_id provided, validate and reuse; otherwise create new
            if conversation_id_str:
                try:
                    conv_id = UUID(conversation_id_str)
                except ValueError:
                    return "Error: Invalid conversation_id format."

                # Verify conversation exists and user is a participant
                from onyx.db.models import InboxConversationParticipant
                from sqlalchemy import select

                participant = db_session.scalar(
                    select(InboxConversationParticipant).where(
                        InboxConversationParticipant.conversation_id == conv_id,
                        InboxConversationParticipant.user_id == user_id,
                    )
                )
                if participant is None:
                    return (
                        "Error: Conversation not found or you are not a "
                        "participant. Starting a new conversation instead "
                        "may be appropriate."
                    )

                from onyx.db.models import InboxConversation

                conversation = db_session.get(InboxConversation, conv_id)
                if conversation is None:
                    return "Error: Conversation not found."
            else:
                conversation = create_conversation(
                    db_session, user_id, recipient.id
                )

            # Add message as AGENT type — no processing status needed
            # since this IS the agent's output, not input to be processed.
            inbox_msg = add_message_to_conversation(
                db_session=db_session,
                conversation_id=conversation.id,
                sender_user_id=user_id,
                sender_type=InboxSenderType.AGENT,
                content=message_text,
            )

            # Notify recipient about the new message
            sender_name = _get_sender_display_name(db_session, user_id)
            publish_event(
                tenant_id=tenant_id,
                user_id=recipient.id,
                event_type="inbox_message",
                data={
                    "conversation_id": str(conversation.id),
                    "message_id": str(inbox_msg.id),
                    "sender_name": sender_name,
                },
            )

            # Check depth limit before dispatching
            recipient_name = (
                recipient.personal_name or recipient.email or "the recipient"
            )

            if not recipient.inbox_auto_reply_enabled:
                return (
                    f"Message delivered to {recipient_name}'s inbox. "
                    "They have auto-reply disabled, so they will see it manually."
                )

            consecutive = count_consecutive_agent_messages(
                db_session, conversation.id
            )
            if consecutive >= INBOX_AGENT_SAFETY_CAP:
                return (
                    f"Message delivered to {recipient_name}'s inbox "
                    "(auto-reply paused — safety cap reached)."
                )

            # Dispatch Celery task
            try:
                from onyx.background.celery.apps.client import celery_app

                celery_app.send_task(
                    OnyxCeleryTask.PROCESS_INBOX_MESSAGE,
                    kwargs={
                        "message_id": str(inbox_msg.id),
                        "tenant_id": tenant_id,
                        "target_user_id": str(recipient.id),
                    },
                    queue=OnyxCeleryQueues.PRIMARY,
                    priority=OnyxCeleryPriority.HIGH,
                )
            except Exception:
                logger.warning(
                    "Failed to dispatch inbox message processing task",
                    exc_info=True,
                )

            return (
                f"Message sent to {recipient_name}. "
                "You'll be notified when they respond."
            )

        except Exception as e:
            logger.exception("send_message failed")
            return f"Error: {e}"

    tool = FunctionTool(
        name="send_message",
        description=schema["description"],
        params_json_schema=schema["parameters"],
        on_invoke_tool=_handle_send_message,
    )

    return [tool]


def create_reply_tool(
    db_session: Session,
    user_id: UUID,
    conversation_id: UUID,
    tenant_id: str,
    skip_dispatch: bool = False,
) -> list[Any]:
    """Create a ``reply`` FunctionTool for inbox message processing.

    Adds a reply message to the SAME conversation thread instead of
    creating a new conversation. Used by InboxAgentOrchestrator so
    agent replies stay in the original thread.

    When ``skip_dispatch`` is True, the reply is added to the thread but
    no Celery task is dispatched.  This avoids duplicate processing when
    the triggering message was a USER message that was already
    dual-dispatched to both agents.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    async def _handle_reply(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            message_text = args.get("message", "").strip()

            if not message_text:
                return "Error: 'message' is required."

            # Add reply to the existing conversation — no processing
            # status since this IS the agent's output.
            inbox_msg = add_message_to_conversation(
                db_session=db_session,
                conversation_id=conversation_id,
                sender_user_id=user_id,
                sender_type=InboxSenderType.AGENT,
                content=message_text,
            )

            # Find the other participant to check if we should dispatch
            from sqlalchemy import select
            from onyx.db.models import InboxConversationParticipant

            other_participant = db_session.scalar(
                select(InboxConversationParticipant).where(
                    InboxConversationParticipant.conversation_id == conversation_id,
                    InboxConversationParticipant.user_id != user_id,
                )
            )
            if other_participant is None:
                return "Reply sent."

            recipient = db_session.get(User, other_participant.user_id)
            if recipient is None:
                return "Reply sent."

            # Notify recipient about the new reply
            sender_name = _get_sender_display_name(db_session, user_id)
            publish_event(
                tenant_id=tenant_id,
                user_id=recipient.id,
                event_type="inbox_message",
                data={
                    "conversation_id": str(conversation_id),
                    "message_id": str(inbox_msg.id),
                    "sender_name": sender_name,
                },
            )

            recipient_name = (
                recipient.personal_name or recipient.email or "the recipient"
            )

            # When skip_dispatch is True, the other agent already
            # received the original user message via dual dispatch.
            # No need to trigger them again for this reply.
            if skip_dispatch:
                return (
                    f"Reply sent to {recipient_name} in the conversation."
                )

            if not recipient.inbox_auto_reply_enabled:
                return (
                    f"Reply sent to {recipient_name}'s inbox. "
                    "They have auto-reply disabled."
                )

            consecutive = count_consecutive_agent_messages(
                db_session, conversation_id
            )
            if consecutive >= INBOX_AGENT_SAFETY_CAP:
                return (
                    f"Reply sent to {recipient_name}'s inbox "
                    "(auto-reply paused — safety cap reached)."
                )

            # Dispatch Celery task
            try:
                from onyx.background.celery.apps.client import celery_app

                celery_app.send_task(
                    OnyxCeleryTask.PROCESS_INBOX_MESSAGE,
                    kwargs={
                        "message_id": str(inbox_msg.id),
                        "tenant_id": tenant_id,
                        "target_user_id": str(recipient.id),
                    },
                    queue=OnyxCeleryQueues.PRIMARY,
                    priority=OnyxCeleryPriority.HIGH,
                )
            except Exception:
                logger.warning(
                    "Failed to dispatch inbox reply processing task",
                    exc_info=True,
                )

            return (
                f"Reply sent to {recipient_name} in the conversation. "
                "You'll be notified when they respond."
            )

        except Exception as e:
            logger.exception("reply failed")
            return f"Error: {e}"

    tool = FunctionTool(
        name="send_message",
        description=(
            "Reply to the sender in this conversation. "
            "Use this to respond to the message you received."
        ),
        params_json_schema={
            "type": "object",
            "properties": {
                "message": {
                    "type": "string",
                    "description": "The reply message content.",
                },
            },
            "required": ["message"],
        },
        on_invoke_tool=_handle_reply,
    )

    return [tool]


def create_notify_user_tool(
    db_session: Session,
    user_id: UUID,
    conversation_id: UUID,
) -> list[Any]:
    """Create a ``notify_user`` FunctionTool for inbox message processing.

    Adds an escalation message to the conversation thread so the human
    user can see why the agent needs help.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    async def _handle_notify_user(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            reason = args.get("reason", "Agent needs your input to respond.")

            # Add escalation message to the conversation as an AGENT message
            add_message_to_conversation(
                db_session=db_session,
                conversation_id=conversation_id,
                sender_user_id=user_id,
                sender_type=InboxSenderType.AGENT,
                content=f"I need my user's help: {reason}",
            )

            return (
                "Your user has been notified. "
                "The message is now awaiting their input."
            )
        except Exception as e:
            logger.exception("notify_user failed")
            return f"Error: {e}"

    tool = FunctionTool(
        name="notify_user",
        description=(
            "Escalate an incoming message to your user when you cannot "
            "answer it from your knowledge, memory, or available tools. "
            "Your user will see the original message and can respond directly."
        ),
        params_json_schema={
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "description": (
                        "Brief explanation of why you need the user's help."
                    ),
                },
            },
            "required": [],
        },
        on_invoke_tool=_handle_notify_user,
    )

    return [tool]
