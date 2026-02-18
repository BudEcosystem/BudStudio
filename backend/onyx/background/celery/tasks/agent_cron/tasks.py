"""Celery tasks for agent cron job scheduling and execution."""

from uuid import UUID

from celery import shared_task
from celery import Task
from redis.lock import Lock as RedisLock
from sqlalchemy import select

from onyx.background.celery.apps.app_base import task_logger
from onyx.configs.constants import CELERY_GENERIC_BEAT_LOCK_TIMEOUT
from onyx.configs.constants import OnyxCeleryPriority
from onyx.configs.constants import OnyxCeleryQueues
from onyx.configs.constants import OnyxCeleryTask
from onyx.configs.constants import OnyxRedisLocks
from onyx.db.agent import create_cron_session
from onyx.db.agent import get_active_session_for_user
from onyx.db.agent import get_workspace_file
from onyx.db.agent import is_session_busy
from onyx.db.agent_cron import advance_cron_job_schedule
from onyx.db.agent_cron import clear_suspension_state
from onyx.db.agent_cron import create_cron_execution
from onyx.db.agent_cron import get_cron_execution
from onyx.db.agent_cron import get_cron_job
from onyx.db.agent_cron import get_due_cron_jobs
from onyx.db.agent_cron import get_last_completed_execution
from onyx.db.agent_cron import has_active_execution_for_job
from onyx.db.agent_cron import is_heartbeat_content_empty
from onyx.db.agent_cron import update_cron_execution_status
from onyx.db.agent_cron import suspend_cron_execution
from onyx.db.engine.sql_engine import get_session_with_current_tenant
from onyx.db.enums import AgentCronExecutionStatus
from onyx.db.enums import AgentCronScheduleType
from onyx.db.models import User
from onyx.redis.redis_pool import get_redis_client


@shared_task(
    name=OnyxCeleryTask.CHECK_FOR_AGENT_CRON_JOBS,
    soft_time_limit=60,
    bind=True,
    ignore_result=True,
)
def check_for_agent_cron_jobs(self: Task, *, tenant_id: str) -> None:
    """Scan for due cron jobs and dispatch execution tasks.

    Runs every 30s via Celery Beat. Uses a Redis lock to prevent
    duplicate dispatching from concurrent invocations.
    """
    task_logger.info("check_for_agent_cron_jobs - Starting")

    redis_client = get_redis_client(tenant_id=tenant_id)
    lock: RedisLock = redis_client.lock(
        OnyxRedisLocks.CHECK_AGENT_CRON_BEAT_LOCK,
        timeout=CELERY_GENERIC_BEAT_LOCK_TIMEOUT,
    )

    if not lock.acquire(blocking=False):
        return None

    enqueued = 0
    try:
        with get_session_with_current_tenant() as db_session:
            due_jobs = get_due_cron_jobs(db_session)

            for job in due_jobs:
                # Create a PENDING execution record
                execution = create_cron_execution(
                    db_session=db_session,
                    cron_job_id=job.id,
                    user_id=job.user_id,
                    scheduled_at=job.next_run_at,
                )

                # Advance the job's schedule
                advance_cron_job_schedule(db_session, job)

                # Dispatch the execution task
                self.app.send_task(
                    OnyxCeleryTask.EXECUTE_AGENT_CRON_JOB,
                    kwargs={
                        "execution_id": str(execution.id),
                        "tenant_id": tenant_id,
                    },
                    queue=OnyxCeleryQueues.PRIMARY,
                    priority=OnyxCeleryPriority.MEDIUM,
                )
                enqueued += 1

    finally:
        if lock.owned():
            lock.release()

    if enqueued > 0:
        task_logger.info(
            f"check_for_agent_cron_jobs - Dispatched {enqueued} executions"
        )
    return None


@shared_task(
    name=OnyxCeleryTask.EXECUTE_AGENT_CRON_JOB,
    soft_time_limit=600,
    bind=True,
    ignore_result=True,
)
def execute_agent_cron_job(
    self: Task, *, execution_id: str, tenant_id: str
) -> None:
    """Execute a single cron job.

    Loads the execution, runs pre-LLM skip checks, creates a cron session,
    runs the CronAgentOrchestrator, and updates the execution status.
    """
    task_logger.info(f"execute_agent_cron_job - Starting execution={execution_id}")

    with get_session_with_current_tenant() as db_session:
        execution = get_cron_execution(db_session, UUID(execution_id))
        if execution is None:
            task_logger.warning(f"Execution {execution_id} not found")
            return None

        job = get_cron_job(db_session, execution.cron_job_id)
        if job is None:
            task_logger.warning(
                f"Cron job {execution.cron_job_id} not found for execution {execution_id}"
            )
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message="Cron job not found",
            )
            return None

        # Load user
        user = db_session.scalar(
            select(User).where(User.id == execution.user_id)
        )
        if user is None:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message="User not found",
            )
            return None

        # --- Pre-LLM Skip Chain ---

        # Skip check 4: concurrent execution
        if has_active_execution_for_job(db_session, job.id):
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.SKIPPED,
                skip_reason="already-in-progress",
            )
            task_logger.info(
                f"Skipped execution {execution_id}: already-in-progress"
            )
            return None

        # Heartbeat-specific skip checks
        if job.is_heartbeat:
            # Skip check 1: empty HEARTBEAT.md
            heartbeat_file = get_workspace_file(
                db_session, user.id, "HEARTBEAT.md"
            )
            heartbeat_content = heartbeat_file.content if heartbeat_file else ""
            if is_heartbeat_content_empty(heartbeat_content):
                update_cron_execution_status(
                    db_session, execution.id,
                    AgentCronExecutionStatus.SKIPPED,
                    skip_reason="empty-heartbeat-file",
                )
                task_logger.info(
                    f"Skipped execution {execution_id}: empty-heartbeat-file"
                )
                return None

        # Skip check 5: one-shot already completed
        if job.schedule_type == AgentCronScheduleType.ONE_SHOT:
            last_completed = get_last_completed_execution(db_session, job.id)
            if (
                last_completed is not None
                and last_completed.status == AgentCronExecutionStatus.COMPLETED
            ):
                update_cron_execution_status(
                    db_session, execution.id,
                    AgentCronExecutionStatus.SKIPPED,
                    skip_reason="one-shot-completed",
                )
                job.enabled = False
                db_session.commit()
                task_logger.info(
                    f"Skipped execution {execution_id}: one-shot-completed, disabled job"
                )
                return None

        # --- Passed all skip checks, proceed with execution ---

        # Skip check: session-busy — if the user is actively chatting,
        # skip to avoid corrupting the in-flight conversation.
        redis_client = get_redis_client(tenant_id=tenant_id)
        active_session = get_active_session_for_user(
            db_session, user.id
        )
        if active_session is not None and is_session_busy(
            redis_client, active_session.id
        ):
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.SKIPPED,
                skip_reason="session-busy",
            )
            task_logger.info(
                f"Skipped execution {execution_id}: session-busy"
            )
            return None

        # Determine which session to use:
        # - If the user has an active (idle) session, inject into it
        # - Otherwise, create a fallback cron session
        if active_session is not None:
            session = active_session
            task_logger.info(
                f"Reusing active session {session.id} for cron execution {execution_id}"
            )
        else:
            session = create_cron_session(
                db_session=db_session,
                user_id=user.id,
                title=f"Cron: {job.name}",
                workspace_path=job.workspace_path,
            )
            task_logger.info(
                f"Created fallback cron session {session.id} for execution {execution_id}"
            )

        # Mark execution as RUNNING
        update_cron_execution_status(
            db_session, execution.id,
            AgentCronExecutionStatus.RUNNING,
        )

        # Update execution with session_id
        execution.session_id = session.id
        db_session.commit()

        # Run the orchestrator
        from onyx.agents.bud_agent.cron_orchestrator import CronAgentOrchestrator

        orchestrator = CronAgentOrchestrator(
            session_id=session.id,
            user=user,
            db_session=db_session,
            execution=execution,
            cron_job=job,
            workspace_path=job.workspace_path,
            model=job.model,
        )

        run_result = orchestrator.run(job.payload_message)

        # If compaction created a new session, update execution's session_id
        if run_result.new_session_id is not None:
            execution.session_id = run_result.new_session_id
            db_session.commit()

        # Handle the result
        if run_result.error:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message=run_result.error,
                tokens_used=run_result.tokens_used,
                tool_calls_count=run_result.tool_call_count,
            )
            task_logger.error(
                f"Cron execution {execution_id} failed: {run_result.error}"
            )

        elif run_result.suspended:
            # Persist suspension state to DB
            suspend_cron_execution(
                db_session=db_session,
                execution_id=execution.id,
                tool_name=run_result.suspended_tool_name or "",
                tool_input=run_result.suspended_tool_input or {},
                tool_call_id=run_result.suspended_tool_call_id or "",
                messages=run_result.suspended_messages or [],
            )
            task_logger.info(
                f"Cron execution {execution_id} suspended for tool: "
                f"{run_result.suspended_tool_name}"
            )

        elif run_result.skipped:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.SKIPPED,
                skip_reason=run_result.skip_reason,
                tokens_used=run_result.tokens_used,
                tool_calls_count=run_result.tool_call_count,
            )
            task_logger.info(
                f"Cron execution {execution_id} skipped: {run_result.skip_reason}"
            )

        else:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.COMPLETED,
                result_summary=run_result.response_text[:2000] if run_result.response_text else None,
                tokens_used=run_result.tokens_used,
                tool_calls_count=run_result.tool_call_count,
            )
            task_logger.info(
                f"Cron execution {execution_id} completed successfully"
            )

    return None


@shared_task(
    name=OnyxCeleryTask.RESUME_AGENT_CRON_EXECUTION,
    soft_time_limit=600,
    bind=True,
    ignore_result=True,
)
def resume_agent_cron_execution(
    self: Task,
    *,
    execution_id: str,
    tool_result_output: str | None = None,
    tool_result_error: str | None = None,
    tenant_id: str,
) -> None:
    """Resume a suspended cron execution after receiving a local tool result.

    Loads the suspended state from DB, appends the tool result,
    and continues the agent loop.
    """
    task_logger.info(
        f"resume_agent_cron_execution - Resuming execution={execution_id}"
    )

    with get_session_with_current_tenant() as db_session:
        execution = get_cron_execution(db_session, UUID(execution_id))
        if execution is None:
            task_logger.warning(f"Execution {execution_id} not found")
            return None

        if execution.status != AgentCronExecutionStatus.SUSPENDED:
            task_logger.warning(
                f"Execution {execution_id} is not SUSPENDED (status={execution.status})"
            )
            return None

        job = get_cron_job(db_session, execution.cron_job_id)
        if job is None:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message="Cron job not found during resume",
            )
            return None

        user = db_session.scalar(
            select(User).where(User.id == execution.user_id)
        )
        if user is None:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message="User not found during resume",
            )
            return None

        # Load suspended state
        messages = execution.suspended_messages or []
        tool_call_id = execution.suspended_tool_call_id or ""
        tool_name = execution.suspended_tool_name or ""

        # Clear suspension state and set back to RUNNING
        clear_suspension_state(db_session, execution.id)

        # Resume the orchestrator
        from onyx.agents.bud_agent.cron_orchestrator import CronAgentOrchestrator

        session_id = execution.session_id
        if session_id is None:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message="No session_id on execution",
            )
            return None

        orchestrator = CronAgentOrchestrator(
            session_id=session_id,
            user=user,
            db_session=db_session,
            execution=execution,
            cron_job=job,
            workspace_path=job.workspace_path,
            model=job.model,
        )

        run_result = orchestrator.resume(
            messages=messages,
            tool_result_output=tool_result_output,
            tool_result_error=tool_result_error,
            tool_call_id=tool_call_id,
            tool_name=tool_name,
        )

        # Handle result (same logic as execute)
        if run_result.error:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.FAILED,
                error_message=run_result.error,
                tokens_used=run_result.tokens_used,
                tool_calls_count=run_result.tool_call_count,
            )
        elif run_result.suspended:
            suspend_cron_execution(
                db_session=db_session,
                execution_id=execution.id,
                tool_name=run_result.suspended_tool_name or "",
                tool_input=run_result.suspended_tool_input or {},
                tool_call_id=run_result.suspended_tool_call_id or "",
                messages=run_result.suspended_messages or [],
            )
        elif run_result.skipped:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.SKIPPED,
                skip_reason=run_result.skip_reason,
                tokens_used=run_result.tokens_used,
                tool_calls_count=run_result.tool_call_count,
            )
        else:
            update_cron_execution_status(
                db_session, execution.id,
                AgentCronExecutionStatus.COMPLETED,
                result_summary=run_result.response_text[:2000] if run_result.response_text else None,
                tokens_used=run_result.tokens_used,
                tool_calls_count=run_result.tool_call_count,
            )
            task_logger.info(
                f"Resumed execution {execution_id} completed successfully"
            )

    return None
