"""Cron job management service for BudAgent.

Provides Agents SDK FunctionTool objects for the ``manage_cron`` tool so
the agent can create, list, update, and delete cron jobs during conversation.

All DB operations are delegated to ``onyx.db.agent_cron``.
"""

import json
from datetime import datetime
from datetime import timezone
from typing import Any
from typing import Callable
from typing import Coroutine
from uuid import UUID

from sqlalchemy.orm import Session

from onyx.db.agent_cron import create_cron_job
from onyx.db.agent_cron import delete_cron_job
from onyx.db.agent_cron import list_cron_jobs_for_user
from onyx.db.agent_cron import update_cron_job
from onyx.db.enums import AgentCronScheduleType
from onyx.utils.logger import setup_logger

logger = setup_logger()


def create_cron_tools(
    db_session: Session,
    user_id: UUID,
) -> list[Any]:
    """Create Agents SDK FunctionTool objects for manage_cron.

    Returns a list containing a single ``FunctionTool`` instance.
    """
    from agents import FunctionTool
    from agents import RunContextWrapper

    from onyx.agents.bud_agent.tool_definitions import REMOTE_TOOL_SCHEMAS

    schema = REMOTE_TOOL_SCHEMAS["manage_cron"]

    async def _handle_manage_cron(
        _ctx: RunContextWrapper[Any], json_string: str
    ) -> str:
        try:
            args: dict[str, Any] = json.loads(json_string) if json_string else {}
            action = args.get("action", "")
            if not action:
                return "Error: 'action' is required."

            if action == "add":
                return _handle_add(args, db_session, user_id)
            elif action == "list":
                return _handle_list(db_session, user_id)
            elif action == "update":
                return _handle_update(args, db_session, user_id)
            elif action == "remove":
                return _handle_remove(args, db_session, user_id)
            else:
                return f"Error: unknown action '{action}'. Use add, list, update, or remove."
        except Exception as e:
            logger.exception("manage_cron failed")
            return f"Error: {e}"

    tool = FunctionTool(
        name="manage_cron",
        description=schema["description"],
        params_json_schema=schema["parameters"],
        on_invoke_tool=_handle_manage_cron,
    )

    return [tool]


def _parse_schedule_type(value: str) -> AgentCronScheduleType:
    """Parse a schedule_type string into the enum, raising ValueError on failure."""
    try:
        return AgentCronScheduleType(value)
    except ValueError:
        valid = ", ".join(t.value for t in AgentCronScheduleType)
        raise ValueError(
            f"Invalid schedule_type '{value}'. Must be one of: {valid}"
        )


def _parse_datetime(value: str) -> datetime:
    """Parse an ISO-8601 datetime string, ensuring UTC timezone."""
    dt = datetime.fromisoformat(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _handle_add(
    args: dict[str, Any],
    db_session: Session,
    user_id: UUID,
) -> str:
    name = args.get("name")
    if not name:
        return "Error: 'name' is required for action 'add'."

    schedule_type_str = args.get("schedule_type")
    if not schedule_type_str:
        return "Error: 'schedule_type' is required for action 'add'."

    payload_message = args.get("payload_message")
    if not payload_message:
        return "Error: 'payload_message' is required for action 'add'."

    try:
        schedule_type = _parse_schedule_type(schedule_type_str)
    except ValueError as e:
        return str(e)

    one_shot_at: datetime | None = None
    if args.get("one_shot_at"):
        try:
            one_shot_at = _parse_datetime(args["one_shot_at"])
        except (ValueError, TypeError) as e:
            return f"Error: invalid one_shot_at datetime: {e}"

    try:
        job = create_cron_job(
            db_session=db_session,
            user_id=user_id,
            name=name,
            schedule_type=schedule_type,
            payload_message=payload_message,
            description=args.get("description"),
            cron_expression=args.get("cron_expression"),
            interval_seconds=args.get("interval_seconds"),
            one_shot_at=one_shot_at,
        )
    except ValueError as e:
        return f"Error creating cron job: {e}"

    next_run = job.next_run_at.isoformat() if job.next_run_at else "N/A"
    return (
        f"Cron job created successfully.\n"
        f"  id: {job.id}\n"
        f"  name: {job.name}\n"
        f"  schedule_type: {job.schedule_type.value}\n"
        f"  next_run_at: {next_run}"
    )


def _handle_list(
    db_session: Session,
    user_id: UUID,
) -> str:
    jobs = list_cron_jobs_for_user(db_session=db_session, user_id=user_id)
    if not jobs:
        return "No cron jobs found."

    lines: list[str] = []
    for i, job in enumerate(jobs, 1):
        enabled = "enabled" if job.enabled else "disabled"
        next_run = job.next_run_at.isoformat() if job.next_run_at else "N/A"
        lines.append(
            f"{i}. [{enabled}] {job.name} "
            f"(id={job.id}, type={job.schedule_type.value}, "
            f"next_run={next_run})"
        )
        if job.description:
            lines.append(f"   Description: {job.description}")
        lines.append(f"   Payload: {job.payload_message}")

    return "\n".join(lines)


def _handle_update(
    args: dict[str, Any],
    db_session: Session,
    user_id: UUID,
) -> str:
    job_id_str = args.get("job_id")
    if not job_id_str:
        return "Error: 'job_id' is required for action 'update'."

    try:
        job_id = UUID(job_id_str)
    except ValueError:
        return f"Error: invalid job_id '{job_id_str}'."

    kwargs: dict[str, Any] = {}

    if "name" in args:
        kwargs["name"] = args["name"]
    if "description" in args:
        kwargs["description"] = args["description"]
    if "enabled" in args:
        kwargs["enabled"] = args["enabled"]
    if "payload_message" in args:
        kwargs["payload_message"] = args["payload_message"]
    if "cron_expression" in args:
        kwargs["cron_expression"] = args["cron_expression"]
    if "interval_seconds" in args:
        kwargs["interval_seconds"] = args["interval_seconds"]

    if "schedule_type" in args:
        try:
            kwargs["schedule_type"] = _parse_schedule_type(args["schedule_type"])
        except ValueError as e:
            return str(e)

    if "one_shot_at" in args:
        try:
            kwargs["one_shot_at"] = _parse_datetime(args["one_shot_at"])
        except (ValueError, TypeError) as e:
            return f"Error: invalid one_shot_at datetime: {e}"

    if not kwargs:
        return "Error: no fields provided to update."

    job = update_cron_job(
        db_session=db_session,
        job_id=job_id,
        user_id=user_id,
        **kwargs,
    )
    if job is None:
        return f"Error: cron job '{job_id}' not found or not owned by you."

    enabled = "enabled" if job.enabled else "disabled"
    next_run = job.next_run_at.isoformat() if job.next_run_at else "N/A"
    return (
        f"Cron job updated successfully.\n"
        f"  id: {job.id}\n"
        f"  name: {job.name}\n"
        f"  status: {enabled}\n"
        f"  next_run_at: {next_run}"
    )


def _handle_remove(
    args: dict[str, Any],
    db_session: Session,
    user_id: UUID,
) -> str:
    job_id_str = args.get("job_id")
    if not job_id_str:
        return "Error: 'job_id' is required for action 'remove'."

    try:
        job_id = UUID(job_id_str)
    except ValueError:
        return f"Error: invalid job_id '{job_id_str}'."

    deleted = delete_cron_job(
        db_session=db_session,
        job_id=job_id,
        user_id=user_id,
    )
    if not deleted:
        return f"Error: cron job '{job_id}' not found or not owned by you."

    return f"Cron job '{job_id}' deleted successfully."
