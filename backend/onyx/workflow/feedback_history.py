"""Feedback history management for the skill evolution pipeline.

Tracks past skill proposals and their outcomes (PENDING, IMPROVED, DISCARDED)
so the Proposer can learn from previous iterations and avoid repeating
discarded proposals.

Entries are stored as FeedbackEntry nodes in Neo4j, linked to Workflow nodes.
"""

from __future__ import annotations

from datetime import datetime, timezone

from onyx.utils.logger import setup_logger
from onyx.workflow.neo4j_client import get_neo4j_client

logger = setup_logger()


async def get_feedback_history(workflow_id: str) -> str:
    """Get accumulated feedback history for a workflow's skill proposals.

    Queries Neo4j for FeedbackEntry nodes linked to the given Workflow,
    and formats them as a markdown log.

    Args:
        workflow_id: The Neo4j Workflow node ID.

    Returns:
        Markdown string with ``## Iteration <id>`` headers per entry,
        or an empty string if no history exists.
    """
    try:
        client = await get_neo4j_client()
        records = await client.execute_read(
            """
            MATCH (w:Workflow {id: $wf_id})-[:HAS_FEEDBACK]->(f:FeedbackEntry)
            RETURN f.iteration AS iteration,
                   f.proposal AS proposal,
                   f.outcome AS outcome,
                   f.score_delta AS score_delta,
                   f.created_at AS created_at
            ORDER BY f.created_at ASC
            """,
            {"wf_id": workflow_id},
        )
    except Exception:
        logger.warning(
            "Failed to fetch feedback history for workflow %s",
            workflow_id,
            exc_info=True,
        )
        return ""

    if not records:
        return ""

    parts: list[str] = []
    for rec in records:
        iteration = rec.get("iteration", "?")
        proposal = rec.get("proposal", "")
        outcome = rec.get("outcome", "PENDING")
        score_delta = rec.get("score_delta")
        created_at = rec.get("created_at", "")

        header = f"## Iteration {iteration}"
        body_lines = [
            f"- **Outcome:** {outcome}",
            f"- **Proposal:** {proposal}",
        ]
        if score_delta is not None:
            body_lines.append(f"- **Score delta:** {score_delta:+.2f}")
        if created_at:
            body_lines.append(f"- **Date:** {created_at}")

        parts.append(header + "\n" + "\n".join(body_lines))

    return "\n\n".join(parts)


async def append_feedback_history(
    workflow_id: str,
    iteration: str,
    proposal: str,
    outcome: str,
    score_delta: float | None = None,
) -> None:
    """Append a proposal outcome to the feedback history.

    Creates a FeedbackEntry node in Neo4j linked to the Workflow node
    via a HAS_FEEDBACK relationship.

    Args:
        workflow_id: The Neo4j Workflow node ID.
        iteration: Unique identifier for this iteration (e.g. UUID or
                   sequential label).
        proposal: Description of what was proposed.
        outcome: One of "PENDING", "IMPROVED", "DISCARDED".
        score_delta: Change in quality score (if measured).
    """
    if outcome not in ("PENDING", "IMPROVED", "DISCARDED"):
        logger.warning(
            "Invalid feedback outcome '%s', defaulting to PENDING", outcome
        )
        outcome = "PENDING"

    now = datetime.now(timezone.utc).isoformat()

    try:
        client = await get_neo4j_client()
        await client.execute_write(
            """
            MATCH (w:Workflow {id: $wf_id})
            CREATE (f:FeedbackEntry {
                iteration: $iteration,
                proposal: $proposal,
                outcome: $outcome,
                score_delta: $score_delta,
                created_at: $created_at
            })
            MERGE (w)-[:HAS_FEEDBACK]->(f)
            """,
            {
                "wf_id": workflow_id,
                "iteration": iteration,
                "proposal": proposal,
                "outcome": outcome,
                "score_delta": score_delta,
                "created_at": now,
            },
        )
        logger.info(
            "Appended feedback entry for workflow %s: iteration=%s outcome=%s",
            workflow_id,
            iteration,
            outcome,
        )
    except Exception:
        logger.error(
            "Failed to append feedback history for workflow %s",
            workflow_id,
            exc_info=True,
        )
