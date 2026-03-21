"""Connects canvas annotations to skill quality scores.

When a user annotates a step or execution on the canvas, this module:
1. Finds the Workflow the step/execution belongs to
2. Checks if the Workflow has a derived Skill (via DERIVED_FROM)
3. Updates the Skill's quality score based on the annotation
4. Optionally triggers Feedback Descent if quality drops below threshold
"""

from onyx.utils.logger import setup_logger
from onyx.workflow.neo4j_client import get_neo4j_client

logger = setup_logger()


async def process_annotation(
    annotation_target_id: str,  # Step or Execution id
    annotation_target_type: str,  # "step" or "execution"
    score: float | None,  # numeric rating (e.g., 1-5)
    label: str | None,  # categorical (e.g., "good", "bad")
    comment: str | None,
    user_id: str,
    tenant_id: str,
) -> None:
    """Process an annotation and update skill quality.

    1. Find the Workflow via: target -> Execution -> Workflow
    2. Check for DERIVED_FROM Skill
    3. Map annotation to quality signal (positive/negative)
    4. Update skill version stats
    5. If cumulative quality drops below 0.5, trigger evolution
    """
    client = await get_neo4j_client()

    # Step 1: Find the workflow
    if annotation_target_type == "step":
        query = (
            "MATCH (s:Step {id: $target_id})<-[:HAS_STEP]-(e:Execution)"
            "<-[:HAS_EXECUTION]-(w:Workflow) "
            "RETURN w.id AS workflow_id"
        )
    else:  # execution
        query = (
            "MATCH (e:Execution {id: $target_id})"
            "<-[:HAS_EXECUTION]-(w:Workflow) "
            "RETURN w.id AS workflow_id"
        )

    result = await client.execute_read(query, {"target_id": annotation_target_id})
    if not result:
        logger.debug(
            "No workflow found for %s %s — skipping quality update",
            annotation_target_type,
            annotation_target_id,
        )
        return

    workflow_id: str = result[0]["workflow_id"]

    # Step 2: Check for derived skill
    skill_result = await client.execute_read(
        "MATCH (sn:SkillNode)-[:DERIVED_FROM]->(w:Workflow {id: $wf_id}) "
        "RETURN sn.skill_id AS skill_id",
        {"wf_id": workflow_id},
    )
    if not skill_result:
        logger.debug(
            "No derived skill for workflow %s — skipping quality update",
            workflow_id,
        )
        return  # No derived skill — nothing to update

    skill_id: str = str(skill_result[0]["skill_id"])

    # Step 3: Map annotation to quality signal
    quality = _annotation_to_quality(score, label)

    # Step 4: Update version stats
    try:
        from onyx.workflow.version_manager import get_latest_version
        from onyx.workflow.version_manager import update_version_stats

        latest = await get_latest_version(skill_id)
        if latest:
            await update_version_stats(latest.id, quality)
            logger.info(
                "Updated skill %s version %d quality from annotation "
                "(quality=%s, target=%s/%s)",
                skill_id,
                latest.version,
                quality,
                annotation_target_type,
                annotation_target_id,
            )

            # Step 5: Check if evolution needed
            # Re-fetch after update to get current stats
            updated = await get_latest_version(skill_id)
            if (
                updated
                and updated.execution_count >= 3
                and updated.success_rate < 0.5
            ):
                await _trigger_evolution(skill_id, tenant_id)
        else:
            logger.debug(
                "No SkillVersion found for skill %s — skipping quality update",
                skill_id,
            )
    except Exception:
        logger.warning(
            "Failed to update skill quality from annotation", exc_info=True
        )


def _annotation_to_quality(score: float | None, label: str | None) -> str:
    """Map annotation score/label to quality string."""
    if label:
        label_lower = label.lower()
        if label_lower in ("good", "correct", "helpful", "thumbs_up"):
            return "success"
        elif label_lower in ("bad", "incorrect", "unhelpful", "thumbs_down"):
            return "failure"
        elif label_lower in ("partial", "okay", "mixed"):
            return "partial"

    if score is not None:
        if score >= 4.0:
            return "success"
        elif score >= 2.5:
            return "partial"
        else:
            return "failure"

    return "partial"  # default


async def _trigger_evolution(skill_id: str, tenant_id: str) -> None:
    """Trigger Feedback Descent for a skill that's underperforming."""
    try:
        from celery import current_app

        from onyx.configs.constants import OnyxCeleryTask

        current_app.send_task(
            OnyxCeleryTask.RUN_SKILL_FEEDBACK_DESCENT,
            kwargs={
                "skill_id": skill_id,
                "tenant_id": tenant_id,
            },
            queue="light",
        )
        logger.info("Triggered Feedback Descent for skill %s", skill_id)
    except Exception:
        logger.warning("Failed to trigger skill evolution", exc_info=True)
