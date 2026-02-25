"""Celery tasks for agent inbox message processing."""

from datetime import datetime
from uuid import UUID

from celery import shared_task
from celery import Task
from sqlalchemy import select

from onyx.background.celery.apps.app_base import task_logger
from onyx.configs.constants import INBOX_AGENT_SAFETY_CAP
from onyx.configs.constants import OnyxCeleryTask
from onyx.db.agent import add_session_message
from onyx.db.agent import create_cron_session
from onyx.db.agent import get_active_session_for_user
from onyx.db.agent import is_session_busy
from onyx.db.agent_inbox import count_consecutive_agent_messages
from onyx.db.agent_inbox import update_message_processing_status
from onyx.db.engine.sql_engine import get_session_with_current_tenant
from onyx.db.enums import AgentMessageRole
from onyx.db.enums import InboxAgentProcessingStatus
from onyx.db.enums import InboxSenderType
from onyx.db.models import InboxConversationParticipant
from onyx.db.models import InboxMessage
from onyx.db.models import User
from onyx.redis.event_publisher import publish_event
from onyx.redis.redis_pool import get_redis_client


def _publish_inbox_status(
    tenant_id: str,
    receiver_id: UUID,
    message: InboxMessage,
    status: str,
) -> None:
    """Helper to publish an inbox_status_change event."""
    publish_event(
        tenant_id=tenant_id,
        user_id=receiver_id,
        event_type="inbox_status_change",
        data={
            "conversation_id": str(message.conversation_id),
            "message_id": str(message.id),
            "status": status,
        },
    )


@shared_task(
    name=OnyxCeleryTask.PROCESS_INBOX_MESSAGE,
    soft_time_limit=600,
    bind=True,
    ignore_result=True,
)
def process_inbox_message(
    self: Task,
    *,
    message_id: str,
    tenant_id: str,
    target_user_id: str | None = None,
) -> None:
    task_logger.info(
        f"process_inbox_message - Starting message={message_id}"
        f" target_user={target_user_id or 'auto'}"
    )

    with get_session_with_current_tenant() as db_session:
        # 1. Load message
        message = db_session.scalar(
            select(InboxMessage).where(InboxMessage.id == UUID(message_id))
        )
        if message is None:
            task_logger.warning(f"Inbox message {message_id} not found")
            return None

        # 2. Check status — skip if already beyond PENDING
        #    When dual-dispatching (both agents), the first task to run
        #    marks PROCESSING; the second should still proceed since it
        #    targets a different agent. We only skip for COMPLETED/FAILED.
        if message.agent_processing_status in (
            InboxAgentProcessingStatus.COMPLETED,
            InboxAgentProcessingStatus.FAILED,
        ):
            task_logger.info(
                f"Inbox message {message_id} already "
                f"{message.agent_processing_status} — skipping"
            )
            return None

        # 3. Determine who processes this message
        if target_user_id:
            # Explicit target — used for dual dispatch
            receiver = db_session.scalar(
                select(User).where(User.id == UUID(target_user_id))
            )
            if receiver is None:
                task_logger.warning(
                    f"Inbox message {message_id}: target user "
                    f"{target_user_id} not found"
                )
                return None
        else:
            # Legacy/default: receiver = the OTHER participant
            receiver_participant = db_session.scalar(
                select(InboxConversationParticipant).where(
                    InboxConversationParticipant.conversation_id
                    == message.conversation_id,
                    InboxConversationParticipant.user_id
                    != message.sender_user_id,
                )
            )
            if receiver_participant is None:
                update_message_processing_status(
                    db_session, message.id,
                    InboxAgentProcessingStatus.FAILED,
                    error_message="No other participant found in conversation",
                )
                return None

            receiver = db_session.scalar(
                select(User).where(User.id == receiver_participant.user_id)
            )
            if receiver is None:
                update_message_processing_status(
                    db_session, message.id,
                    InboxAgentProcessingStatus.FAILED,
                    error_message="Receiver user not found",
                )
                return None

        # 4. Check auto-reply enabled
        if not receiver.inbox_auto_reply_enabled:
            task_logger.info(
                f"Inbox message {message_id}: receiver {receiver.id} "
                "has auto-reply disabled"
            )
            return None

        # 5. Compute consecutive agent messages and check safety cap
        consecutive = count_consecutive_agent_messages(
            db_session, message.conversation_id
        )
        if consecutive >= INBOX_AGENT_SAFETY_CAP:
            task_logger.info(
                f"Inbox message {message_id}: safety cap reached "
                f"({consecutive}/{INBOX_AGENT_SAFETY_CAP})"
            )
            update_message_processing_status(
                db_session, message.id,
                InboxAgentProcessingStatus.COMPLETED,
                result_summary="Safety cap reached",
            )
            return None

        # 6. Mark as PROCESSING
        update_message_processing_status(
            db_session, message.id,
            InboxAgentProcessingStatus.PROCESSING,
        )

        # Load sender and receiver info for prompt
        sender = db_session.scalar(
            select(User).where(User.id == message.sender_user_id)
        )
        sender_name = "Unknown"
        sender_email = "unknown"
        if sender is not None:
            sender_name = sender.personal_name or sender.email or "Unknown"
            sender_email = sender.email or "unknown"

        receiver_name = receiver.personal_name or receiver.email or "Unknown"

        # 7. Create dedicated session
        session = create_cron_session(
            db_session=db_session,
            user_id=receiver.id,
            title=f"Inbox: message from {sender_name}",
        )
        message.session_id = session.id
        db_session.commit()

        # 8. Build prompt with conversation history
        from onyx.db.agent_inbox import get_conversation_messages

        conv_messages = get_conversation_messages(
            db_session, message.conversation_id, limit=20
        )

        # Build conversation history (exclude the current message)
        history_lines: list[str] = []
        for m in conv_messages:
            if m.id == message.id:
                continue
            m_sender_name = "Unknown"
            if m.sender:
                m_sender_name = m.sender.personal_name or m.sender.email or "Unknown"
            role_label = f"{m_sender_name}'s Agent" if m.sender_type == InboxSenderType.AGENT else m_sender_name
            history_lines.append(f"[{role_label}]: {m.content}")

        conversation_context = ""
        if history_lines:
            conversation_context = (
                "Here is the conversation history so far:\n\n"
                + "\n\n".join(history_lines)
                + "\n\n---\n\n"
            )

        # Depth awareness context
        depth_context = ""
        if consecutive > 0:
            depth_context = (
                f"\nNote: You have sent {consecutive} consecutive "
                "reply/replies without a human response in this conversation.\n"
            )
        if receiver.inbox_reply_depth_limit is not None:
            depth_context += (
                f"Your user prefers limiting auto-replies to "
                f"{receiver.inbox_reply_depth_limit}.\n"
            )

        # Determine relationship: is this the agent's own user talking,
        # or the other party?
        is_own_user = message.sender_user_id == receiver.id
        sender_is_human = message.sender_type == InboxSenderType.USER

        # Find the other party's name for prompt context
        other_participant = db_session.scalar(
            select(InboxConversationParticipant).where(
                InboxConversationParticipant.conversation_id
                == message.conversation_id,
                InboxConversationParticipant.user_id != receiver.id,
            )
        )
        other_user = (
            db_session.get(User, other_participant.user_id)
            if other_participant
            else None
        )
        other_name = (
            (other_user.personal_name or other_user.email or "Unknown")
            if other_user
            else sender_name
        )

        if is_own_user:
            # The agent's own user sent a message in the conversation.
            # Treat it as a direct instruction from the user to their agent.
            sender_label = f"your user {receiver_name}"
            extra_guidance = (
                f"\n## IMPORTANT: This is a direct instruction from YOUR user\n"
                f"Your user ({receiver_name}) wrote this message in the "
                f"conversation with {other_name}. Treat it as a direct "
                f"instruction to you. If they are telling you to do something "
                f"(schedule a reminder, send a message, take an action), DO IT. "
                f"If they are providing information that the other party "
                f"({other_name}) needs, forward it by replying to {other_name}. "
                f"Do NOT escalate back to your user — they just told you what "
                f"to do.\n"
            )
        elif sender_is_human:
            sender_label = f"{sender_name} (the human, NOT their agent)"
            extra_guidance = (
                f"\n## IMPORTANT: This is a direct human message\n"
                f"This message was written by {sender_name} personally "
                f"(not by their agent). Human messages that answer a question, "
                f"provide requested information, or make a decision should "
                f"almost always be escalated to {receiver_name} via notify_user "
                f"so they see the response. Only 'do nothing' for pure "
                f"pleasantries with zero informational content.\n"
            )
        else:
            sender_label = f"{sender_name}'s agent"
            extra_guidance = ""

        payload_message = (
            f"You are acting as {receiver_name}'s agent in this conversation "
            f"with {other_name}.\n\n"
            f"{conversation_context}"
            f"New message from {sender_label} ({sender_email}):\n\n"
            f'"{message.content}"\n\n'
            f"{depth_context}"
            f"{extra_guidance}\n"
            "## CRITICAL: Use the conversation history\n"
            "READ the full conversation history above before acting. It "
            "contains facts, dates, times, decisions, and agreements already "
            "made. Do NOT ask for or escalate information that is already "
            "stated in the history.\n\n"
            "## How to respond\n\n"
            "Pick ONE of three actions:\n\n"
            f"1. **Escalate** (notify_user): Use when the message contains "
            f"NEW information {receiver_name} needs to see — an answer to a "
            f"question, a confirmed time/date/decision, or a request needing "
            f"{receiver_name}'s input. Also use when you genuinely need "
            f"{receiver_name}'s decision to proceed.\n\n"
            f"2. **Reply** (send_message): Use to reply to {other_name} "
            f"when the message contains a question you can answer or when "
            "you need to follow up for more details. "
            f"If {other_name}'s answer is vague, follow up with THEM — "
            f"do not ask {receiver_name}.\n\n"
            "3. **Do nothing**: Use when the message adds NO new information "
            "— pure acknowledgments ('thanks', 'ok', 'sounds good', 'noted', "
            "'see you then'), confirmations of something already known, or "
            "summaries of what was already said.\n\n"
            "## AVOIDING DUPLICATES\n"
            "Before escalating or replying, check the conversation history "
            "for messages from yourself (marked as "
            f"\"{receiver_name}'s Agent\"). If you already escalated or "
            "replied about the SAME topic/information in a recent message, "
            "do nothing — your user already has that information. Only "
            "escalate for genuinely NEW information not yet communicated.\n\n"
            "## STRICT RULES\n"
            "- NEVER reply just to say 'thanks', 'noted', 'confirmed'. "
            "These create noise.\n"
            "- NEVER repeat or paraphrase what the other party just said.\n"
            "- NEVER ask for information already in the conversation history.\n"
            "- NEVER escalate the same information twice — check your prior "
            "messages in the history first.\n"
            f"- You are {receiver_name}'s agent. You can only take actions "
            f"(reminders, cron jobs, etc.) on behalf of {receiver_name}. "
            f"If {other_name} asks for something for THEMSELVES "
            f"(e.g. 'give me a reminder'), that is for {other_name}'s own "
            f"agent — not you."
        )

        from onyx.agents.bud_agent.inbox_orchestrator import InboxAgentOrchestrator

        orchestrator = InboxAgentOrchestrator(
            session_id=session.id,
            user=receiver,
            db_session=db_session,
            message=message,
            tenant_id=tenant_id,
        )

        run_result = orchestrator.run(payload_message)

        # 9-10. Handle result
        if run_result.error:
            update_message_processing_status(
                db_session, message.id,
                InboxAgentProcessingStatus.FAILED,
                error_message=run_result.error,
            )
            _publish_inbox_status(tenant_id, receiver.id, message, "failed")
            task_logger.error(
                f"Inbox message {message_id} processing failed: {run_result.error}"
            )
        elif run_result.awaiting_user:
            update_message_processing_status(
                db_session, message.id,
                InboxAgentProcessingStatus.COMPLETED,
                result_summary="Escalated to user",
            )
            _publish_inbox_status(tenant_id, receiver.id, message, "completed")
            task_logger.info(f"Inbox message {message_id}: agent escalated to user")

            # Inject proactive message into user's main session
            # (Skip the current inbox session — it's about to be
            # marked COMPLETED and is not the user's interactive session.)
            try:
                main_session = get_active_session_for_user(
                    db_session, receiver.id,
                    exclude_session_id=session.id,
                )
                if main_session is None:
                    main_session = create_cron_session(
                        db_session=db_session,
                        user_id=receiver.id,
                        title="Agent notifications",
                    )

                redis_client = get_redis_client(tenant_id=tenant_id)
                if not is_session_busy(redis_client, main_session.id):
                    escalation_reason = (
                        run_result.escalation_reason
                        or "I need your input to respond."
                    )
                    proactive_msg = (
                        f"Hey {receiver_name}, {other_name} just sent you "
                        f"a message that I need your help with:\n\n"
                        f'"{message.content}"\n\n'
                        f"{escalation_reason}\n\n"
                        f"What would you like me to tell {other_name}?"
                    )
                    add_session_message(
                        db_session=db_session,
                        session_id=main_session.id,
                        role=AgentMessageRole.ASSISTANT,
                        content=proactive_msg,
                    )
                    publish_event(
                        tenant_id=tenant_id,
                        user_id=receiver.id,
                        event_type="session_message",
                        data={"session_id": str(main_session.id)},
                    )
                    task_logger.info(
                        f"Inbox message {message_id}: injected proactive "
                        f"message into main session {main_session.id}"
                    )
                else:
                    task_logger.info(
                        f"Inbox message {message_id}: main session "
                        f"{main_session.id} is busy, skipping proactive "
                        f"message (context builder will handle it)"
                    )
            except Exception:
                task_logger.warning(
                    f"Inbox message {message_id}: failed to inject "
                    "proactive message into main session",
                    exc_info=True,
                )
        elif run_result.replied:
            update_message_processing_status(
                db_session, message.id,
                InboxAgentProcessingStatus.COMPLETED,
                result_summary=(
                    run_result.response_text[:2000]
                    if run_result.response_text
                    else None
                ),
            )
            _publish_inbox_status(tenant_id, receiver.id, message, "completed")
            task_logger.info(f"Inbox message {message_id} processed successfully")
        elif run_result.no_action:
            update_message_processing_status(
                db_session, message.id,
                InboxAgentProcessingStatus.COMPLETED,
                result_summary="No action needed",
            )
            _publish_inbox_status(tenant_id, receiver.id, message, "completed")
            task_logger.info(
                f"Inbox message {message_id}: agent chose no action"
            )
        else:
            update_message_processing_status(
                db_session, message.id,
                InboxAgentProcessingStatus.COMPLETED,
                result_summary=(
                    run_result.response_text[:2000]
                    if run_result.response_text
                    else "No response generated."
                ),
            )
            _publish_inbox_status(tenant_id, receiver.id, message, "completed")
            task_logger.info(f"Inbox message {message_id} completed (no explicit reply)")

        # Mark the inbox session as COMPLETED so it doesn't appear
        # as the user's active session in the main chat view.
        session.status = "completed"
        session.completed_at = datetime.utcnow()
        db_session.commit()

    return None
