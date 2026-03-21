"""Skill Evolution Engine — population-based evolution and Feedback Descent.

Provides two refinement strategies:

1. **SkillEvolver** — population-based evolution. Maintains a frontier of
   top-N skill versions. On each cycle it selects a parent, proposes changes
   via the Proposer, implements via the Generator, and adds a new version.
   Triggered periodically when a skill's failure rate exceeds 30%.

2. **FeedbackDescentRefiner** — rapid single-skill refinement inspired by
   arxiv.org/abs/2511.07919. Uses pairwise LLM comparison instead of
   population-based selection. Feedback history resets on improvement.
   Triggered by explicit user feedback (canvas annotation, thumbs down).

Both strategies rely on the shared Proposer, Generator, feedback history,
and version manager modules.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from uuid import uuid4

from onyx.utils.logger import setup_logger
from onyx.workflow.neo4j_client import get_neo4j_client

logger = setup_logger()

# Failure rate threshold that triggers evolution
_FAILURE_RATE_THRESHOLD = 0.3

# Minimum executions before we trust the failure rate signal
_MIN_EXECUTIONS_FOR_EVOLUTION = 5


# ---------------------------------------------------------------------------
# Class 1: SkillEvolver (Population-Based Evolution)
# ---------------------------------------------------------------------------


class SkillEvolver:
    """Population-based skill evolution.

    Maintains a frontier of top-N skill versions. On each evolution cycle,
    selects a parent from the frontier, proposes changes via the Proposer,
    implements via the Generator, and adds the new version to the frontier.

    Triggered by the periodic pipeline when a skill's failure rate > 30%.
    """

    def __init__(self, skill_id: str, tenant_id: str) -> None:
        self._skill_id = skill_id
        self._tenant_id = tenant_id

    async def should_evolve(self) -> bool:
        """Check if this skill needs evolution.

        Returns True if failure rate > 30% across recent executions.
        Queries Neo4j for executions linked to this skill's workflow via
        the (:SkillNode)-[:DERIVED_FROM]->(:Workflow) relationship.
        """
        try:
            client = await get_neo4j_client()

            # Find executions linked to workflows that this skill derives from
            results = await client.execute_read(
                "MATCH (sk:SkillNode {skill_id: $skillId})"
                "-[:DERIVED_FROM]->(w:Workflow)"
                "-[:HAS_EXECUTION]->(e:Execution) "
                "WHERE e.quality IS NOT NULL "
                "RETURN e.quality AS quality "
                "ORDER BY e.created_at DESC "
                "LIMIT 20",
                {"skillId": str(self._skill_id)},
            )

            if len(results) < _MIN_EXECUTIONS_FOR_EVOLUTION:
                logger.debug(
                    "SkillEvolver: skill %s has only %d executions "
                    "(need %d) -- skipping",
                    self._skill_id,
                    len(results),
                    _MIN_EXECUTIONS_FOR_EVOLUTION,
                )
                return False

            failure_count = sum(
                1
                for r in results
                if r.get("quality") in ("failure", "partial")
            )
            failure_rate = failure_count / len(results)

            logger.info(
                "SkillEvolver: skill %s failure_rate=%.2f "
                "(%d/%d recent executions)",
                self._skill_id,
                failure_rate,
                failure_count,
                len(results),
            )
            return failure_rate > _FAILURE_RATE_THRESHOLD

        except Exception:
            logger.warning(
                "SkillEvolver: failed to check evolution need for skill %s",
                self._skill_id,
                exc_info=True,
            )
            return False

    async def evolve(self) -> bool:
        """Run one evolution cycle.

        1. Gather recent execution traces from Neo4j
        2. Select parent from frontier
        3. Call Proposer (diagnosis)
        4. Call Generator (implementation)
        5. Create new version
        6. Update skill in PostgreSQL
        7. Append feedback history

        Returns True if evolution succeeded, False otherwise.
        """
        from onyx.workflow.feedback_history import append_feedback_history
        from onyx.workflow.proposer import propose_skill
        from onyx.workflow.skill_generator import generate_skill
        from onyx.workflow.version_manager import (
            create_version,
            select_parent,
        )

        iteration_id = str(uuid4())[:8]
        logger.info(
            "SkillEvolver: starting evolution cycle for skill %s "
            "(iteration=%s)",
            self._skill_id,
            iteration_id,
        )

        try:
            client = await get_neo4j_client()

            # ----------------------------------------------------------
            # 1. Find the workflow(s) this skill is derived from
            # ----------------------------------------------------------
            wf_results = await client.execute_read(
                "MATCH (sk:SkillNode {skill_id: $skillId})"
                "-[:DERIVED_FROM]->(w:Workflow) "
                "RETURN w.id AS workflow_id "
                "LIMIT 1",
                {"skillId": str(self._skill_id)},
            )

            if not wf_results:
                logger.warning(
                    "SkillEvolver: no DERIVED_FROM workflow found "
                    "for skill %s",
                    self._skill_id,
                )
                return False

            workflow_id: str = wf_results[0]["workflow_id"]

            # ----------------------------------------------------------
            # 2. Gather execution traces
            # ----------------------------------------------------------
            execution_traces = await _get_execution_traces(
                client, workflow_id
            )
            if not execution_traces:
                logger.info(
                    "SkillEvolver: no execution traces for workflow %s",
                    workflow_id,
                )
                return False

            # ----------------------------------------------------------
            # 3. Gather flow steps from the workflow's latest execution
            # ----------------------------------------------------------
            flow_steps = await _get_flow_steps(client, workflow_id)

            # ----------------------------------------------------------
            # 4. Select parent from frontier
            # ----------------------------------------------------------
            parent = await select_parent(self._skill_id, strategy="best")

            # ----------------------------------------------------------
            # 5. Get existing skill details from PostgreSQL
            # ----------------------------------------------------------
            existing_skills = _get_existing_skills_list(self._tenant_id)
            current_instructions = _get_skill_instructions_by_id(
                self._skill_id, self._tenant_id
            )
            current_slug = _get_skill_slug_by_id(
                self._skill_id, self._tenant_id
            )

            if current_instructions is None or current_slug is None:
                logger.warning(
                    "SkillEvolver: could not load skill %s from PostgreSQL",
                    self._skill_id,
                )
                return False

            # ----------------------------------------------------------
            # 6. Get feedback history
            # ----------------------------------------------------------
            from onyx.workflow.feedback_history import get_feedback_history

            feedback_history = await get_feedback_history(workflow_id)

            # ----------------------------------------------------------
            # 7. Call Proposer (diagnosis)
            # ----------------------------------------------------------
            proposal = await propose_skill(
                flow_steps=flow_steps,
                execution_traces=execution_traces,
                existing_skills=existing_skills,
                feedback_history=feedback_history,
                action_hint="edit",
                target_skill_slug=current_slug,
            )

            if proposal is None:
                logger.warning(
                    "SkillEvolver: proposer returned None for skill %s",
                    self._skill_id,
                )
                await append_feedback_history(
                    workflow_id=workflow_id,
                    iteration=iteration_id,
                    proposal="(proposer returned None)",
                    outcome="DISCARDED",
                )
                return False

            logger.info(
                "SkillEvolver: proposer action=%s proposed=%s",
                proposal.action,
                proposal.proposed_skill[:80],
            )

            # ----------------------------------------------------------
            # 8. Call Generator (implementation)
            # ----------------------------------------------------------
            result = await generate_skill(
                proposal=proposal.model_dump(),
                flow_steps=flow_steps,
                existing_instructions=current_instructions,
            )

            if result is None:
                logger.warning(
                    "SkillEvolver: generator returned None for skill %s",
                    self._skill_id,
                )
                await append_feedback_history(
                    workflow_id=workflow_id,
                    iteration=iteration_id,
                    proposal=proposal.proposed_skill,
                    outcome="DISCARDED",
                )
                return False

            logger.info(
                "SkillEvolver: generator produced slug=%s name=%s",
                result.slug,
                result.name,
            )

            # ----------------------------------------------------------
            # 9. Create new version in Neo4j
            # ----------------------------------------------------------
            new_version = await create_version(
                skill_id=self._skill_id,
                instructions=result.instructions,
                source="evolution",
                source_workflow_id=workflow_id,
            )

            logger.info(
                "SkillEvolver: created version v%d for skill %s",
                new_version.version,
                self._skill_id,
            )

            # ----------------------------------------------------------
            # 10. Update skill in PostgreSQL
            # ----------------------------------------------------------
            _update_skill_in_pg(
                skill_id=self._skill_id,
                tenant_id=self._tenant_id,
                name=result.name,
                description=result.description,
                instructions=result.instructions,
            )

            # ----------------------------------------------------------
            # 11. Append feedback history
            # ----------------------------------------------------------
            await append_feedback_history(
                workflow_id=workflow_id,
                iteration=iteration_id,
                proposal=proposal.proposed_skill,
                outcome="IMPROVED",
            )

            logger.info(
                "SkillEvolver: evolution cycle completed for skill %s "
                "(version v%d)",
                self._skill_id,
                new_version.version,
            )
            return True

        except Exception:
            logger.error(
                "SkillEvolver: evolution cycle failed for skill %s",
                self._skill_id,
                exc_info=True,
            )
            return False


# ---------------------------------------------------------------------------
# Class 2: FeedbackDescentRefiner (Rapid Single-Skill Refinement)
# ---------------------------------------------------------------------------


class FeedbackDescentRefiner:
    """Feedback Descent for rapid skill refinement.

    Based on arxiv.org/abs/2511.07919. Uses pairwise comparison instead
    of population-based evolution. Key difference: feedback history RESETS
    on improvement (not accumulated).

    Triggered by explicit user feedback (canvas annotation, thumbs down).
    """

    def __init__(self, skill_id: str, tenant_id: str) -> None:
        self._skill_id = skill_id
        self._tenant_id = tenant_id

    async def refine(
        self,
        max_iterations: int = 5,
        no_improvement_limit: int = 3,
    ) -> str | None:
        """Run Feedback Descent refinement loop.

        For each iteration:
        1. Propose candidate refinement
        2. Compare current_best vs candidate via LLM evaluator
        3. If candidate wins: update skill, reset feedback history
        4. If current wins: append rationale to feedback history
        5. Early stop if no improvement for k iterations

        Returns the final instructions, or None if no improvement was made.
        """
        from onyx.workflow.feedback_history import (
            append_feedback_history,
            get_feedback_history,
        )
        from onyx.workflow.proposer import propose_skill
        from onyx.workflow.skill_generator import generate_skill
        from onyx.workflow.version_manager import create_version

        logger.info(
            "FeedbackDescent: starting refinement for skill %s "
            "(max_iter=%d, no_improve_limit=%d)",
            self._skill_id,
            max_iterations,
            no_improvement_limit,
        )

        try:
            client = await get_neo4j_client()

            # Find the workflow this skill derives from
            wf_results = await client.execute_read(
                "MATCH (sk:SkillNode {skill_id: $skillId})"
                "-[:DERIVED_FROM]->(w:Workflow) "
                "RETURN w.id AS workflow_id "
                "LIMIT 1",
                {"skillId": str(self._skill_id)},
            )

            if not wf_results:
                logger.warning(
                    "FeedbackDescent: no DERIVED_FROM workflow found "
                    "for skill %s",
                    self._skill_id,
                )
                return None

            workflow_id: str = wf_results[0]["workflow_id"]

            # Gather execution traces (used for pairwise comparison)
            execution_traces = await _get_execution_traces(
                client, workflow_id
            )
            flow_steps = await _get_flow_steps(client, workflow_id)
            existing_skills = _get_existing_skills_list(self._tenant_id)

            # Load current best instructions
            current_best = _get_skill_instructions_by_id(
                self._skill_id, self._tenant_id
            )
            current_slug = _get_skill_slug_by_id(
                self._skill_id, self._tenant_id
            )

            if current_best is None or current_slug is None:
                logger.warning(
                    "FeedbackDescent: could not load skill %s",
                    self._skill_id,
                )
                return None

            no_improvement_streak = 0
            improved = False

            for iteration in range(1, max_iterations + 1):
                iteration_id = f"fd-{iteration}"
                logger.info(
                    "FeedbackDescent: iteration %d/%d for skill %s",
                    iteration,
                    max_iterations,
                    self._skill_id,
                )

                # Get feedback history (resets on improvement)
                feedback_history = await get_feedback_history(workflow_id)

                # ---- Step 1: Propose candidate ----
                proposal = await propose_skill(
                    flow_steps=flow_steps,
                    execution_traces=execution_traces,
                    existing_skills=existing_skills,
                    feedback_history=feedback_history,
                    action_hint="edit",
                    target_skill_slug=current_slug,
                )

                if proposal is None:
                    logger.warning(
                        "FeedbackDescent: proposer returned None "
                        "on iteration %d",
                        iteration,
                    )
                    no_improvement_streak += 1
                    if no_improvement_streak >= no_improvement_limit:
                        logger.info(
                            "FeedbackDescent: stopping early — "
                            "%d consecutive failures to propose",
                            no_improvement_streak,
                        )
                        break
                    continue

                # ---- Step 2: Generate candidate instructions ----
                result = await generate_skill(
                    proposal=proposal.model_dump(),
                    flow_steps=flow_steps,
                    existing_instructions=current_best,
                )

                if result is None:
                    logger.warning(
                        "FeedbackDescent: generator returned None "
                        "on iteration %d",
                        iteration,
                    )
                    no_improvement_streak += 1
                    if no_improvement_streak >= no_improvement_limit:
                        break
                    continue

                candidate_instructions = result.instructions

                # ---- Step 3: Pairwise comparison ----
                preference, rationale = await _compare_skill_versions(
                    current_instructions=current_best,
                    candidate_instructions=candidate_instructions,
                    execution_traces=execution_traces,
                )

                logger.info(
                    "FeedbackDescent: iteration %d preference=%s "
                    "rationale=%s",
                    iteration,
                    preference,
                    rationale[:120] if rationale else "",
                )

                if preference == "candidate":
                    # ---- Candidate wins ----
                    logger.info(
                        "FeedbackDescent: candidate wins on iteration %d "
                        "— updating skill %s",
                        iteration,
                        self._skill_id,
                    )

                    # Create new version
                    await create_version(
                        skill_id=self._skill_id,
                        instructions=candidate_instructions,
                        source="feedback_descent",
                        source_workflow_id=workflow_id,
                    )

                    # Update PostgreSQL
                    _update_skill_in_pg(
                        skill_id=self._skill_id,
                        tenant_id=self._tenant_id,
                        name=result.name,
                        description=result.description,
                        instructions=candidate_instructions,
                    )

                    # Reset feedback history on improvement — clear
                    # existing entries by appending IMPROVED marker
                    await append_feedback_history(
                        workflow_id=workflow_id,
                        iteration=iteration_id,
                        proposal=proposal.proposed_skill,
                        outcome="IMPROVED",
                    )

                    # Reset tracking
                    current_best = candidate_instructions
                    no_improvement_streak = 0
                    improved = True

                else:
                    # ---- Current wins — accumulate feedback ----
                    no_improvement_streak += 1

                    await append_feedback_history(
                        workflow_id=workflow_id,
                        iteration=iteration_id,
                        proposal=proposal.proposed_skill,
                        outcome="DISCARDED",
                    )

                    if no_improvement_streak >= no_improvement_limit:
                        logger.info(
                            "FeedbackDescent: stopping early — "
                            "%d consecutive no-improvement iterations",
                            no_improvement_streak,
                        )
                        break

            if improved:
                logger.info(
                    "FeedbackDescent: completed with improvement "
                    "for skill %s",
                    self._skill_id,
                )
                return current_best
            else:
                logger.info(
                    "FeedbackDescent: completed with no improvement "
                    "for skill %s",
                    self._skill_id,
                )
                return None

        except Exception:
            logger.error(
                "FeedbackDescent: refinement failed for skill %s",
                self._skill_id,
                exc_info=True,
            )
            return None


# ---------------------------------------------------------------------------
# Helper: LLM Evaluator for Feedback Descent
# ---------------------------------------------------------------------------

_EVALUATOR_SYSTEM_PROMPT = """\
You are an impartial evaluator comparing two versions of an AI agent skill. \
You will receive:

1. **Version A** (current): the skill instructions currently in use.
2. **Version B** (candidate): a proposed replacement.
3. **Execution traces**: recent real executions where the skill was applied.

Your job is to decide which version would **better handle** the execution \
traces — producing more reliable, correct, and complete results.

## Evaluation Criteria

- **Correctness**: Does the version lead to accurate outputs?
- **Completeness**: Does it handle edge cases shown in the traces?
- **Clarity**: Are the instructions clear and unambiguous for the agent?
- **Robustness**: Does it gracefully handle partial inputs or failures?

## Output

Return ONLY valid JSON (no markdown fences, no commentary):

{
  "preference": "current" | "candidate",
  "rationale": "One or two sentences explaining your decision."
}
"""


async def _compare_skill_versions(
    current_instructions: str,
    candidate_instructions: str,
    execution_traces: list[dict[str, Any]],
) -> tuple[str, str]:
    """Pairwise comparison of two skill versions.

    Uses LLM to evaluate which version would better handle the given traces.

    Returns:
        (preference, rationale) where preference is "current" or "candidate"
    """
    from langchain_core.messages import HumanMessage, SystemMessage

    from onyx.llm.factory import get_default_llms
    from onyx.llm.interfaces import LLM

    # Build user prompt
    traces_str = json.dumps(execution_traces[:5], default=str)
    if len(traces_str) > 2000:
        traces_str = traces_str[:2000] + "..."

    # Truncate instructions if very long
    current_trunc = current_instructions[:3000]
    candidate_trunc = candidate_instructions[:3000]

    user_prompt = (
        "## Version A (current)\n\n"
        f"{current_trunc}\n\n"
        "## Version B (candidate)\n\n"
        f"{candidate_trunc}\n\n"
        "## Recent Execution Traces\n\n"
        f"{traces_str}\n\n"
        "Which version would better handle these execution patterns? "
        "Return your evaluation as JSON."
    )

    try:
        _main_llm, fast_llm = get_default_llms(
            temperature=0.0,
            timeout=30,
        )
        llm: LLM = fast_llm

        prompt = [
            SystemMessage(content=_EVALUATOR_SYSTEM_PROMPT),
            HumanMessage(content=user_prompt),
        ]

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: llm.invoke(
                prompt=prompt,
                timeout_override=30,
                max_tokens=256,
            ),
        )

        raw_text = ""
        if hasattr(result, "content"):
            raw_text = str(result.content).strip()
        else:
            raw_text = str(result).strip()

        logger.info(
            "Evaluator LLM response (len=%d): %s",
            len(raw_text),
            raw_text[:200],
        )

        # Parse response
        preference, rationale = _parse_evaluator_response(raw_text)
        return preference, rationale

    except Exception:
        logger.warning(
            "Evaluator LLM call failed, defaulting to 'current'",
            exc_info=True,
        )
        return "current", "Evaluation failed — keeping current version."


def _parse_evaluator_response(raw_text: str) -> tuple[str, str]:
    """Parse the evaluator LLM JSON response.

    Returns (preference, rationale). Falls back to "current" on parse failure.
    """
    text = raw_text.strip()
    # Strip markdown fences
    if text.startswith("```"):
        first_nl = text.index("\n") if "\n" in text else len(text)
        text = text[first_nl + 1:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        logger.warning(
            "Evaluator returned invalid JSON: %s", text[:200]
        )
        return "current", "Failed to parse evaluator response."

    preference = data.get("preference", "current")
    if preference not in ("current", "candidate"):
        preference = "current"

    rationale = data.get("rationale", "")
    return preference, rationale


# ---------------------------------------------------------------------------
# Shared helpers (Neo4j queries, PostgreSQL lookups)
# ---------------------------------------------------------------------------


async def _get_execution_traces(
    client: Any,
    workflow_id: str,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Fetch recent execution traces for a workflow from Neo4j."""
    try:
        results = await client.execute_read(
            "MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution) "
            "OPTIONAL MATCH (e)-[:HAS_STEP]->(s:Step) "
            "WITH e, collect({name: s.name, description: s.description, "
            "  status: s.status}) AS steps "
            "ORDER BY e.created_at DESC "
            "LIMIT $limit "
            "RETURN e.id AS id, e.quality AS quality, "
            "  e.pattern_summary AS pattern_summary, "
            "  e.root_cause AS root_cause, steps",
            {"wfId": workflow_id, "limit": limit},
        )
        return [dict(r) for r in results]
    except Exception:
        logger.warning(
            "evolution: failed to fetch execution traces for workflow=%s",
            workflow_id,
            exc_info=True,
        )
        return []


async def _get_flow_steps(
    client: Any,
    workflow_id: str,
) -> list[dict[str, Any]]:
    """Get the flow steps from the most recent execution of a workflow."""
    try:
        results = await client.execute_read(
            "MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution)"
            "-[:HAS_STEP]->(s:Step) "
            "WITH e, s ORDER BY e.created_at DESC, s.position ASC "
            "LIMIT 20 "
            "RETURN s.name AS name, s.description AS description",
            {"wfId": workflow_id},
        )
        return [dict(r) for r in results]
    except Exception:
        logger.warning(
            "evolution: failed to fetch flow steps for workflow=%s",
            workflow_id,
            exc_info=True,
        )
        return []


def _get_existing_skills_list(tenant_id: str) -> list[dict[str, Any]]:
    """Load all enabled skills from PostgreSQL as a list of dicts."""
    try:
        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.skills import get_skills

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            skills = get_skills(db_session, only_enabled=True)
            return [
                {
                    "slug": s.slug,
                    "name": s.name,
                    "description": s.description,
                }
                for s in skills
            ]
    except Exception:
        logger.warning(
            "evolution: failed to load existing skills",
            exc_info=True,
        )
        return []


def _get_skill_instructions_by_id(
    skill_id: str,
    tenant_id: str,
) -> str | None:
    """Load the current instructions for a skill by its PG ID."""
    try:
        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.skills import get_skill_by_id

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            skill = get_skill_by_id(int(skill_id), db_session)
            return skill.instructions
    except Exception:
        logger.warning(
            "evolution: failed to load skill instructions for id=%s",
            skill_id,
            exc_info=True,
        )
        return None


def _get_skill_slug_by_id(
    skill_id: str,
    tenant_id: str,
) -> str | None:
    """Load the slug for a skill by its PG ID."""
    try:
        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.skills import get_skill_by_id

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            skill = get_skill_by_id(int(skill_id), db_session)
            return skill.slug
    except Exception:
        logger.warning(
            "evolution: failed to load skill slug for id=%s",
            skill_id,
            exc_info=True,
        )
        return None


def _update_skill_in_pg(
    skill_id: str,
    tenant_id: str,
    name: str,
    description: str,
    instructions: str,
) -> None:
    """Update a skill's content in PostgreSQL."""
    try:
        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.skills import update_skill

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            update_skill(
                skill_id=int(skill_id),
                db_session=db_session,
                name=name,
                description=description,
                instructions=instructions,
            )
            logger.info(
                "evolution: updated skill id=%s in PostgreSQL",
                skill_id,
            )
    except Exception:
        logger.error(
            "evolution: failed to update skill id=%s in PostgreSQL",
            skill_id,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Discovery: find all skills that have DERIVED_FROM relationships
# ---------------------------------------------------------------------------


async def get_evolvable_skill_ids() -> list[str]:
    """Return PostgreSQL skill IDs that have DERIVED_FROM edges in Neo4j.

    These are the skills eligible for periodic evolution checks.
    """
    try:
        client = await get_neo4j_client()
        results = await client.execute_read(
            "MATCH (sk:SkillNode)-[:DERIVED_FROM]->(w:Workflow) "
            "RETURN DISTINCT sk.skill_id AS skill_id",
            {},
        )
        return [str(r["skill_id"]) for r in results if r.get("skill_id")]
    except Exception:
        logger.warning(
            "evolution: failed to discover evolvable skills",
            exc_info=True,
        )
        return []
