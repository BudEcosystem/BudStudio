"""API endpoints for agent cron job management."""

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from onyx.auth.users import current_user
from onyx.configs.constants import OnyxCeleryPriority
from onyx.configs.constants import OnyxCeleryQueues
from onyx.configs.constants import OnyxCeleryTask
from onyx.db.agent_cron import acknowledge_notification
from onyx.db.agent_cron import create_cron_execution
from onyx.db.agent_cron import create_cron_job
from onyx.db.agent_cron import delete_cron_job
from onyx.db.agent_cron import get_cron_execution
from onyx.db.agent_cron import get_cron_job_for_user
from onyx.db.agent_cron import get_pending_notifications
from onyx.db.agent_cron import get_pending_tool_requests
from onyx.db.agent_cron import list_cron_jobs_for_user
from onyx.db.agent_cron import update_cron_job
from onyx.db.engine.sql_engine import get_session
from onyx.db.enums import AgentCronExecutionStatus
from onyx.db.enums import AgentCronScheduleType
from onyx.db.models import User
from onyx.utils.logger import setup_logger

logger = setup_logger()


router = APIRouter(prefix="/agent/cron", tags=["Agent Cron"])


# ==============================================================================
# Request/Response Models
# ==============================================================================


class CreateCronJobRequest(BaseModel):
    name: str
    description: str | None = None
    schedule_type: str
    cron_expression: str | None = None
    interval_seconds: int | None = None
    one_shot_at: datetime | None = None
    payload_message: str
    workspace_path: str | None = None
    model: str | None = None
    is_heartbeat: bool = False


class UpdateCronJobRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    enabled: bool | None = None
    schedule_type: str | None = None
    cron_expression: str | None = None
    interval_seconds: int | None = None
    one_shot_at: datetime | None = None
    payload_message: str | None = None
    workspace_path: str | None = None
    model: str | None = None
    is_heartbeat: bool | None = None


class CronJobSnapshot(BaseModel):
    id: str
    user_id: str
    name: str
    description: str | None
    enabled: bool
    schedule_type: str
    cron_expression: str | None
    interval_seconds: int | None
    one_shot_at: datetime | None
    payload_message: str
    workspace_path: str | None
    model: str | None
    is_heartbeat: bool
    next_run_at: datetime | None
    last_run_at: datetime | None
    run_count: int
    created_at: datetime
    updated_at: datetime


class CronJobListResponse(BaseModel):
    jobs: list[CronJobSnapshot]


class CronNotificationSnapshot(BaseModel):
    id: str
    cron_job_id: str
    cron_job_name: str
    status: str
    result_summary: str | None
    error_message: str | None
    skip_reason: str | None
    completed_at: datetime | None
    created_at: datetime


class CronToolRequestSnapshot(BaseModel):
    id: str
    cron_job_id: str
    cron_job_name: str
    session_id: str | None
    tool_name: str | None
    tool_input: dict[str, Any] | None
    tool_call_id: str | None
    created_at: datetime


class PendingCronDataResponse(BaseModel):
    notifications: list[CronNotificationSnapshot]
    tool_requests: list[CronToolRequestSnapshot]


class ToolResultSubmission(BaseModel):
    output: str | None = None
    error: str | None = None


class StatusResponse(BaseModel):
    status: str


# ==============================================================================
# Helper functions
# ==============================================================================


def _job_to_snapshot(job: Any) -> CronJobSnapshot:
    return CronJobSnapshot(
        id=str(job.id),
        user_id=str(job.user_id),
        name=job.name,
        description=job.description,
        enabled=job.enabled,
        schedule_type=job.schedule_type.value if hasattr(job.schedule_type, "value") else str(job.schedule_type),
        cron_expression=job.cron_expression,
        interval_seconds=job.interval_seconds,
        one_shot_at=job.one_shot_at,
        payload_message=job.payload_message,
        workspace_path=job.workspace_path,
        model=job.model,
        is_heartbeat=job.is_heartbeat,
        next_run_at=job.next_run_at,
        last_run_at=job.last_run_at,
        run_count=job.run_count,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


# ==============================================================================
# Cron Job CRUD
# ==============================================================================


@router.post("/jobs")
def create_job(
    request: CreateCronJobRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> CronJobSnapshot:
    """Create a new cron job."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    try:
        schedule_type = AgentCronScheduleType(request.schedule_type)
    except ValueError:
        valid = [s.value for s in AgentCronScheduleType]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid schedule_type. Valid values: {valid}",
        )

    try:
        job = create_cron_job(
            db_session=db_session,
            user_id=user.id,
            name=request.name,
            schedule_type=schedule_type,
            payload_message=request.payload_message,
            description=request.description,
            cron_expression=request.cron_expression,
            interval_seconds=request.interval_seconds,
            one_shot_at=request.one_shot_at,
            workspace_path=request.workspace_path,
            model=request.model,
            is_heartbeat=request.is_heartbeat,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return _job_to_snapshot(job)


@router.get("/jobs")
def list_jobs(
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> CronJobListResponse:
    """List all cron jobs for the current user."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    jobs = list_cron_jobs_for_user(db_session, user.id)
    return CronJobListResponse(jobs=[_job_to_snapshot(j) for j in jobs])


@router.get("/jobs/{job_id}")
def get_job(
    job_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> CronJobSnapshot:
    """Get a specific cron job."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    job = get_cron_job_for_user(db_session, job_id, user.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Cron job not found")

    return _job_to_snapshot(job)


@router.patch("/jobs/{job_id}")
def update_job(
    job_id: UUID,
    request: UpdateCronJobRequest,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> CronJobSnapshot:
    """Update a cron job."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    update_fields: dict[str, Any] = {}
    for field_name in request.model_fields:
        value = getattr(request, field_name)
        if value is not None:
            if field_name == "schedule_type":
                try:
                    value = AgentCronScheduleType(value)
                except ValueError:
                    valid = [s.value for s in AgentCronScheduleType]
                    raise HTTPException(
                        status_code=400,
                        detail=f"Invalid schedule_type. Valid values: {valid}",
                    )
            update_fields[field_name] = value

    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    job = update_cron_job(db_session, job_id, user.id, **update_fields)
    if job is None:
        raise HTTPException(status_code=404, detail="Cron job not found")

    return _job_to_snapshot(job)


@router.delete("/jobs/{job_id}")
def delete_job(
    job_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Delete a cron job and all its executions."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    deleted = delete_cron_job(db_session, job_id, user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Cron job not found")

    return StatusResponse(status="deleted")


@router.post("/jobs/{job_id}/run-now")
def run_now(
    job_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Trigger an immediate execution of a cron job."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    job = get_cron_job_for_user(db_session, job_id, user.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Cron job not found")

    execution = create_cron_execution(
        db_session=db_session,
        cron_job_id=job.id,
        user_id=user.id,
    )

    # Dispatch execution task via Celery
    from onyx.background.celery.apps.client import celery_app

    celery_app.send_task(
        OnyxCeleryTask.EXECUTE_AGENT_CRON_JOB,
        kwargs={
            "execution_id": str(execution.id),
            "tenant_id": "public",  # default tenant
        },
        queue=OnyxCeleryQueues.PRIMARY,
        priority=OnyxCeleryPriority.HIGH,
    )

    return StatusResponse(status="dispatched")


# ==============================================================================
# Execution & Polling
# ==============================================================================


@router.get("/pending")
def get_pending(
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> PendingCronDataResponse:
    """Get pending notifications and tool requests for the current user.

    Designed for lightweight desktop polling.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    notifications = get_pending_notifications(db_session, user.id)
    tool_requests = get_pending_tool_requests(db_session, user.id)

    notif_snapshots: list[CronNotificationSnapshot] = []
    for n in notifications:
        job_name = n.cron_job.name if n.cron_job else "Unknown"
        notif_snapshots.append(
            CronNotificationSnapshot(
                id=str(n.id),
                cron_job_id=str(n.cron_job_id),
                cron_job_name=job_name,
                status=n.status.value if hasattr(n.status, "value") else str(n.status),
                result_summary=n.result_summary,
                error_message=n.error_message,
                skip_reason=n.skip_reason,
                completed_at=n.completed_at,
                created_at=n.created_at,
            )
        )

    tool_snapshots: list[CronToolRequestSnapshot] = []
    for t in tool_requests:
        job_name = t.cron_job.name if t.cron_job else "Unknown"
        tool_snapshots.append(
            CronToolRequestSnapshot(
                id=str(t.id),
                cron_job_id=str(t.cron_job_id),
                cron_job_name=job_name,
                session_id=str(t.session_id) if t.session_id else None,
                tool_name=t.suspended_tool_name,
                tool_input=t.suspended_tool_input,
                tool_call_id=t.suspended_tool_call_id,
                created_at=t.created_at,
            )
        )

    return PendingCronDataResponse(
        notifications=notif_snapshots,
        tool_requests=tool_snapshots,
    )


@router.post("/executions/{execution_id}/tool-result")
def submit_tool_result(
    execution_id: UUID,
    request: ToolResultSubmission,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Submit a local tool result for a suspended cron execution.

    Dispatches a resume task via Celery.
    """
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    execution = get_cron_execution(db_session, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found")

    if execution.user_id != user.id:
        raise HTTPException(status_code=404, detail="Execution not found")

    if execution.status != AgentCronExecutionStatus.SUSPENDED:
        raise HTTPException(
            status_code=409,
            detail="Execution is not in SUSPENDED state",
        )

    # Dispatch resume task
    from onyx.background.celery.apps.client import celery_app

    celery_app.send_task(
        OnyxCeleryTask.RESUME_AGENT_CRON_EXECUTION,
        kwargs={
            "execution_id": str(execution.id),
            "tool_result_output": request.output,
            "tool_result_error": request.error,
            "tenant_id": "public",
        },
        queue=OnyxCeleryQueues.PRIMARY,
        priority=OnyxCeleryPriority.HIGH,
    )

    return StatusResponse(status="resume-dispatched")


@router.post("/executions/{execution_id}/acknowledge")
def acknowledge(
    execution_id: UUID,
    user: User | None = Depends(current_user),
    db_session: Session = Depends(get_session),
) -> StatusResponse:
    """Mark a cron notification as read."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    updated = acknowledge_notification(db_session, execution_id, user.id)
    if not updated:
        raise HTTPException(
            status_code=404, detail="Notification not found"
        )

    return StatusResponse(status="acknowledged")
