"""Database operations for agent cron jobs and executions."""

from datetime import datetime
from datetime import timedelta
from datetime import timezone
from typing import Any
from uuid import UUID

from croniter import croniter
from sqlalchemy import desc
from sqlalchemy import select
from sqlalchemy import update
from sqlalchemy.orm import Session

from onyx.db.enums import AgentCronExecutionStatus
from onyx.db.enums import AgentCronScheduleType
from onyx.db.models import AgentCronExecution
from onyx.db.models import AgentCronJob


def compute_next_run_at(
    schedule_type: AgentCronScheduleType,
    cron_expression: str | None = None,
    interval_seconds: int | None = None,
    one_shot_at: datetime | None = None,
    base_time: datetime | None = None,
) -> datetime | None:
    """Compute the next run time for a cron job based on its schedule type."""
    now = base_time or datetime.now(tz=timezone.utc)

    if schedule_type == AgentCronScheduleType.CRON:
        if not cron_expression:
            return None
        cron = croniter(cron_expression, now)
        next_dt: datetime = cron.get_next(datetime)
        if next_dt.tzinfo is None:
            next_dt = next_dt.replace(tzinfo=timezone.utc)
        return next_dt

    elif schedule_type == AgentCronScheduleType.INTERVAL:
        if not interval_seconds or interval_seconds <= 0:
            return None
        return now + timedelta(seconds=interval_seconds)

    elif schedule_type == AgentCronScheduleType.ONE_SHOT:
        if not one_shot_at:
            return None
        if one_shot_at.tzinfo is None:
            one_shot_at = one_shot_at.replace(tzinfo=timezone.utc)
        return one_shot_at if one_shot_at > now else None

    return None


def _validate_cron_expression(expression: str) -> bool:
    """Validate a cron expression."""
    return croniter.is_valid(expression)


def create_cron_job(
    db_session: Session,
    user_id: UUID,
    name: str,
    schedule_type: AgentCronScheduleType,
    payload_message: str,
    description: str | None = None,
    cron_expression: str | None = None,
    interval_seconds: int | None = None,
    one_shot_at: datetime | None = None,
    workspace_path: str | None = None,
    model: str | None = None,
) -> AgentCronJob:
    """Create a new cron job with validated schedule.

    Raises ValueError if the schedule configuration is invalid.
    """
    if schedule_type == AgentCronScheduleType.CRON:
        if not cron_expression:
            raise ValueError("cron_expression is required for CRON schedule type")
        if not _validate_cron_expression(cron_expression):
            raise ValueError(f"Invalid cron expression: {cron_expression}")

    elif schedule_type == AgentCronScheduleType.INTERVAL:
        if not interval_seconds or interval_seconds <= 0:
            raise ValueError(
                "interval_seconds must be a positive integer for INTERVAL schedule type"
            )

    elif schedule_type == AgentCronScheduleType.ONE_SHOT:
        if not one_shot_at:
            raise ValueError("one_shot_at is required for ONE_SHOT schedule type")

    next_run = compute_next_run_at(
        schedule_type=schedule_type,
        cron_expression=cron_expression,
        interval_seconds=interval_seconds,
        one_shot_at=one_shot_at,
    )

    job = AgentCronJob(
        user_id=user_id,
        name=name,
        description=description,
        schedule_type=schedule_type,
        cron_expression=cron_expression,
        interval_seconds=interval_seconds,
        one_shot_at=one_shot_at,
        payload_message=payload_message,
        workspace_path=workspace_path,
        model=model,
        next_run_at=next_run,
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def get_cron_job(
    db_session: Session,
    job_id: UUID,
) -> AgentCronJob | None:
    """Get a cron job by ID."""
    stmt = select(AgentCronJob).where(AgentCronJob.id == job_id)
    return db_session.execute(stmt).scalar_one_or_none()


def get_cron_job_for_user(
    db_session: Session,
    job_id: UUID,
    user_id: UUID,
) -> AgentCronJob | None:
    """Get a cron job by ID, ensuring it belongs to the specified user."""
    stmt = select(AgentCronJob).where(
        AgentCronJob.id == job_id,
        AgentCronJob.user_id == user_id,
    )
    return db_session.execute(stmt).scalar_one_or_none()


def list_cron_jobs_for_user(
    db_session: Session,
    user_id: UUID,
    enabled_only: bool = False,
) -> list[AgentCronJob]:
    """List cron jobs for a user, ordered by creation time."""
    stmt = select(AgentCronJob).where(AgentCronJob.user_id == user_id)
    if enabled_only:
        stmt = stmt.where(AgentCronJob.enabled.is_(True))
    stmt = stmt.order_by(desc(AgentCronJob.created_at))
    return list(db_session.execute(stmt).scalars().all())


def update_cron_job(
    db_session: Session,
    job_id: UUID,
    user_id: UUID,
    **kwargs: Any,
) -> AgentCronJob | None:
    """Update a cron job. Returns None if not found or unauthorized."""
    job = get_cron_job_for_user(db_session, job_id, user_id)
    if job is None:
        return None

    allowed_fields = {
        "name", "description", "enabled", "schedule_type",
        "cron_expression", "interval_seconds", "one_shot_at",
        "payload_message", "workspace_path", "model",
    }

    for key, value in kwargs.items():
        if key in allowed_fields:
            setattr(job, key, value)

    # Recompute next_run_at if schedule changed
    schedule_fields = {"schedule_type", "cron_expression", "interval_seconds", "one_shot_at"}
    if schedule_fields & set(kwargs.keys()):
        job.next_run_at = compute_next_run_at(
            schedule_type=job.schedule_type,
            cron_expression=job.cron_expression,
            interval_seconds=job.interval_seconds,
            one_shot_at=job.one_shot_at,
        )

    db_session.commit()
    db_session.refresh(job)
    return job


def delete_cron_job(
    db_session: Session,
    job_id: UUID,
    user_id: UUID,
) -> bool:
    """Delete a cron job and all its executions. Returns True if deleted."""
    job = get_cron_job_for_user(db_session, job_id, user_id)
    if job is None:
        return False
    db_session.delete(job)
    db_session.commit()
    return True


def get_due_cron_jobs(
    db_session: Session,
) -> list[AgentCronJob]:
    """Get all enabled cron jobs whose next_run_at is in the past."""
    now = datetime.now(tz=timezone.utc)
    stmt = (
        select(AgentCronJob)
        .where(
            AgentCronJob.enabled.is_(True),
            AgentCronJob.next_run_at.isnot(None),
            AgentCronJob.next_run_at <= now,
        )
        .order_by(AgentCronJob.next_run_at)
    )
    return list(db_session.execute(stmt).scalars().all())


def advance_cron_job_schedule(
    db_session: Session,
    job: AgentCronJob,
) -> None:
    """Advance next_run_at and update last_run_at for a cron job."""
    now = datetime.now(tz=timezone.utc)
    job.last_run_at = now
    job.run_count += 1
    job.next_run_at = compute_next_run_at(
        schedule_type=job.schedule_type,
        cron_expression=job.cron_expression,
        interval_seconds=job.interval_seconds,
        one_shot_at=job.one_shot_at,
        base_time=now,
    )
    db_session.commit()


# --- Execution operations ---


def create_cron_execution(
    db_session: Session,
    cron_job_id: UUID,
    user_id: UUID,
    scheduled_at: datetime | None = None,
) -> AgentCronExecution:
    """Create a new cron execution record in PENDING status."""
    execution = AgentCronExecution(
        cron_job_id=cron_job_id,
        user_id=user_id,
        status=AgentCronExecutionStatus.PENDING,
        scheduled_at=scheduled_at or datetime.now(tz=timezone.utc),
    )
    db_session.add(execution)
    db_session.commit()
    db_session.refresh(execution)
    return execution


def get_cron_execution(
    db_session: Session,
    execution_id: UUID,
) -> AgentCronExecution | None:
    """Get a cron execution by ID."""
    stmt = select(AgentCronExecution).where(AgentCronExecution.id == execution_id)
    return db_session.execute(stmt).scalar_one_or_none()


def update_cron_execution_status(
    db_session: Session,
    execution_id: UUID,
    status: AgentCronExecutionStatus,
    result_summary: str | None = None,
    error_message: str | None = None,
    skip_reason: str | None = None,
    session_id: UUID | None = None,
    tokens_used: int | None = None,
    tool_calls_count: int | None = None,
) -> AgentCronExecution | None:
    """Update the status and optional fields of a cron execution."""
    execution = get_cron_execution(db_session, execution_id)
    if execution is None:
        return None

    execution.status = status

    now = datetime.now(tz=timezone.utc)
    if status == AgentCronExecutionStatus.RUNNING and execution.started_at is None:
        execution.started_at = now
    if status.is_terminal():
        execution.completed_at = now

    if result_summary is not None:
        execution.result_summary = result_summary
    if error_message is not None:
        execution.error_message = error_message
    if skip_reason is not None:
        execution.skip_reason = skip_reason
    if session_id is not None:
        execution.session_id = session_id
    if tokens_used is not None:
        execution.tokens_used = tokens_used
    if tool_calls_count is not None:
        execution.tool_calls_count = tool_calls_count

    db_session.commit()
    db_session.refresh(execution)
    return execution


def suspend_cron_execution(
    db_session: Session,
    execution_id: UUID,
    tool_name: str,
    tool_input: dict[str, Any],
    tool_call_id: str,
    messages: list[dict[str, Any]],
) -> AgentCronExecution | None:
    """Suspend an execution, persisting the agent state for later resume."""
    execution = get_cron_execution(db_session, execution_id)
    if execution is None:
        return None

    execution.status = AgentCronExecutionStatus.SUSPENDED
    execution.suspended_tool_name = tool_name
    execution.suspended_tool_input = tool_input
    execution.suspended_tool_call_id = tool_call_id
    execution.suspended_messages = messages

    db_session.commit()
    db_session.refresh(execution)
    return execution


def clear_suspension_state(
    db_session: Session,
    execution_id: UUID,
) -> None:
    """Clear suspension state after resuming."""
    execution = get_cron_execution(db_session, execution_id)
    if execution is None:
        return

    execution.suspended_tool_name = None
    execution.suspended_tool_input = None
    execution.suspended_tool_call_id = None
    execution.suspended_messages = None
    execution.status = AgentCronExecutionStatus.RUNNING
    db_session.commit()


def has_active_execution_for_job(
    db_session: Session,
    cron_job_id: UUID,
) -> bool:
    """Check if there is an active (RUNNING or SUSPENDED) execution for a job."""
    stmt = select(AgentCronExecution).where(
        AgentCronExecution.cron_job_id == cron_job_id,
        AgentCronExecution.status.in_([
            AgentCronExecutionStatus.RUNNING,
            AgentCronExecutionStatus.SUSPENDED,
        ]),
    )
    return db_session.execute(stmt).scalar_one_or_none() is not None


def get_last_completed_execution(
    db_session: Session,
    cron_job_id: UUID,
) -> AgentCronExecution | None:
    """Get the most recent COMPLETED execution for a job."""
    stmt = (
        select(AgentCronExecution)
        .where(
            AgentCronExecution.cron_job_id == cron_job_id,
            AgentCronExecution.status == AgentCronExecutionStatus.COMPLETED,
        )
        .order_by(desc(AgentCronExecution.completed_at))
        .limit(1)
    )
    return db_session.execute(stmt).scalar_one_or_none()


def get_pending_notifications(
    db_session: Session,
    user_id: UUID,
) -> list[AgentCronExecution]:
    """Get unread terminal executions for a user (notifications).

    Includes COMPLETED, FAILED, and SKIPPED executions so users
    get feedback on all cron job runs, including skipped ones.
    """
    stmt = (
        select(AgentCronExecution)
        .where(
            AgentCronExecution.user_id == user_id,
            AgentCronExecution.is_notification_read.is_(False),
            AgentCronExecution.status.in_([
                AgentCronExecutionStatus.COMPLETED,
                AgentCronExecutionStatus.FAILED,
                AgentCronExecutionStatus.SKIPPED,
            ]),
        )
        .order_by(desc(AgentCronExecution.completed_at))
        .limit(50)
    )
    return list(db_session.execute(stmt).scalars().all())


def get_pending_tool_requests(
    db_session: Session,
    user_id: UUID,
) -> list[AgentCronExecution]:
    """Get suspended executions awaiting local tool results for a user."""
    stmt = (
        select(AgentCronExecution)
        .where(
            AgentCronExecution.user_id == user_id,
            AgentCronExecution.status == AgentCronExecutionStatus.SUSPENDED,
        )
        .order_by(AgentCronExecution.created_at)
    )
    return list(db_session.execute(stmt).scalars().all())


def acknowledge_notification(
    db_session: Session,
    execution_id: UUID,
    user_id: UUID,
) -> bool:
    """Mark a notification as read. Returns True if updated."""
    stmt = (
        update(AgentCronExecution)
        .where(
            AgentCronExecution.id == execution_id,
            AgentCronExecution.user_id == user_id,
        )
        .values(is_notification_read=True)
    )
    result = db_session.execute(stmt)
    db_session.commit()
    return result.rowcount > 0  # type: ignore[union-attr]


def acknowledge_all_notifications(
    db_session: Session,
    user_id: UUID,
) -> int:
    """Mark all unread notifications as read. Returns count of updated rows."""
    stmt = (
        update(AgentCronExecution)
        .where(
            AgentCronExecution.user_id == user_id,
            AgentCronExecution.is_notification_read == False,  # noqa: E712
            AgentCronExecution.status.in_([
                AgentCronExecutionStatus.COMPLETED,
                AgentCronExecutionStatus.FAILED,
                AgentCronExecutionStatus.SKIPPED,
            ]),
        )
        .values(is_notification_read=True)
    )
    result = db_session.execute(stmt)
    db_session.commit()
    return result.rowcount  # type: ignore[union-attr]


