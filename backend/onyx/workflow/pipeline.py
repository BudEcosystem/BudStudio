"""Post-conversation skill evolution pipeline.

Orchestrates the full Judge -> Neo4j Write -> Proposer Check -> Proposer ->
Generator -> Auto-promote flow that runs after a conversation closes.

Called from the ``run_post_conversation_pipeline_task`` Celery task.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from onyx.utils.logger import setup_logger
from onyx.workflow.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from onyx.workflow.neo4j_client import Neo4jClient

logger = setup_logger()

# Minimum execution count before proposing a new skill
_MIN_EXECUTIONS_FOR_SKILL = 2


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def run_post_conversation_pipeline(
    session_id: str,
    tenant_id: str,
    user_id: str,
    llm: Any = None,
) -> None:
    """Full post-conversation pipeline.

    1. Judge -- synthesize clean flow + quality assessment
    2. Neo4j Write -- write clean flow as Workflow -> Execution -> Steps
    3. Proposer Check -- should we create/evolve a skill?
    4. Proposer -- diagnosis LLM call (if check says yes)
    5. Generator -- implementation LLM call
    6. Auto-promote -- create/update skill in PostgreSQL
    7. DERIVED_FROM edge -- link skill to Workflow in Neo4j

    Args:
        session_id: Agent session UUID.
        tenant_id: Tenant identifier for DB/Redis scoping.
        user_id: User UUID who owns the conversation.
        llm: Optional pre-configured LLM instance from the orchestrator.
             When provided, passed through to judge, proposer, and generator
             to avoid re-acquiring LLM credentials in a background context.
    """
    logger.info(
        "pipeline: starting for session=%s tenant=%s user=%s",
        session_id, tenant_id, user_id,
    )

    # ------------------------------------------------------------------
    # Step 0: Resolve the conversation goal (inbox conversations only)
    # ------------------------------------------------------------------
    goal = _get_conversation_goal(session_id, tenant_id)

    # ------------------------------------------------------------------
    # Step 1: Judge -- synthesize clean flow + quality assessment
    # ------------------------------------------------------------------
    from onyx.workflow.judge import judge_conversation

    judgment = await judge_conversation(session_id, tenant_id, goal=goal, user_id=user_id, llm=llm)
    if judgment is None:
        logger.info("pipeline: judge returned None for session %s -- done", session_id)
        return

    logger.info(
        "pipeline: judge quality=%s pattern=%s steps=%d for session %s",
        judgment.quality,
        judgment.pattern_summary[:80] if judgment.pattern_summary else "",
        len(judgment.flow),
        session_id,
    )

    # ------------------------------------------------------------------
    # Step 2: Write to Neo4j (Workflow + Execution + Steps)
    # ------------------------------------------------------------------
    client = Neo4jClient(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    try:
        workflow_id = await _write_judgment_to_neo4j(
            client=client,
            judgment=judgment,
            session_id=session_id,
            tenant_id=tenant_id,
            user_id=user_id,
        )
        if workflow_id is None:
            logger.warning(
                "pipeline: failed to write judgment to Neo4j for session %s",
                session_id,
            )
            return

        logger.info(
            "pipeline: wrote judgment to Neo4j workflow=%s for session %s",
            workflow_id,
            session_id,
        )

        # --------------------------------------------------------------
        # Step 3: Proposer Check -- should we create/evolve a skill?
        # --------------------------------------------------------------
        action, target_skill_slug = await _proposer_check(
            client=client,
            workflow_id=workflow_id,
            quality=judgment.quality,
        )

        if action is None:
            logger.info(
                "pipeline: proposer check says no action needed for "
                "workflow=%s session=%s",
                workflow_id,
                session_id,
            )
            return

        logger.info(
            "pipeline: proposer check action=%s target=%s for workflow=%s",
            action,
            target_skill_slug,
            workflow_id,
        )

        # --------------------------------------------------------------
        # Step 4: Proposer -- diagnosis LLM call
        # --------------------------------------------------------------
        from onyx.workflow.proposer import propose_skill

        # Gather context for proposer
        execution_traces = await _get_execution_traces(client, workflow_id)
        existing_skills = _get_existing_skills_list(tenant_id)
        feedback_history = await _get_feedback_history(client, workflow_id)

        proposal = await propose_skill(
            flow_steps=[s.model_dump() for s in judgment.flow],
            execution_traces=execution_traces,
            existing_skills=existing_skills,
            feedback_history=feedback_history,
            action_hint=action,
            target_skill_slug=target_skill_slug,
            user_id=user_id,
            tenant_id=tenant_id,
            llm=llm,
            pattern_summary=judgment.pattern_summary,
        )

        if proposal is None:
            logger.warning(
                "pipeline: proposer returned None for workflow=%s session=%s",
                workflow_id,
                session_id,
            )
            return

        logger.info(
            "pipeline: proposer action=%s proposed=%s for workflow=%s",
            proposal.action,
            proposal.proposed_skill[:80],
            workflow_id,
        )

        # --------------------------------------------------------------
        # Step 5: Generator -- implementation LLM call
        # Check if proposer already returned a full skill definition
        # (some LLMs embed slug/name/description/instructions directly)
        # --------------------------------------------------------------
        from onyx.workflow.models import GeneratorOutput
        from onyx.workflow.skill_generator import generate_skill

        result: GeneratorOutput | None = None

        # Try to parse proposer's proposed_skill as a full skill definition
        try:
            import json as _json
            proposed_data = _json.loads(proposal.proposed_skill)
            if (
                isinstance(proposed_data, dict)
                and proposed_data.get("slug")
                and proposed_data.get("name")
                and proposed_data.get("instructions")
            ):
                result = GeneratorOutput(
                    slug=proposed_data["slug"],
                    name=proposed_data["name"],
                    description=proposed_data.get("description", ""),
                    instructions=proposed_data["instructions"],
                )
                logger.info(
                    "pipeline: proposer already provided full skill def "
                    "slug=%s — skipping generator",
                    result.slug,
                )
        except (ValueError, TypeError, KeyError):
            pass  # Not a full skill def — proceed to Generator

        if result is None:
            # If editing, load current instructions
            existing_instructions: str | None = None
            if proposal.action == "edit" and proposal.target_skill:
                existing_instructions = _get_existing_skill_instructions(
                    proposal.target_skill, tenant_id
                )

            result = await generate_skill(
                proposal=proposal.model_dump(),
                flow_steps=[s.model_dump() for s in judgment.flow],
                existing_instructions=existing_instructions,
                user_id=user_id,
                tenant_id=tenant_id,
                llm=llm,
            )

        if result is None:
            logger.warning(
                "pipeline: generator returned None for workflow=%s session=%s",
                workflow_id,
                session_id,
            )
            return

        logger.info(
            "pipeline: skill produced slug=%s name=%s for workflow=%s",
            result.slug,
            result.name,
            workflow_id,
        )

        # --------------------------------------------------------------
        # Step 6: Auto-promote -- create/update skill in PostgreSQL
        # --------------------------------------------------------------
        skill_id = _auto_promote_skill(
            result=result,
            action=proposal.action,
            target_skill_slug=proposal.target_skill,
            tenant_id=tenant_id,
        )

        if skill_id is None:
            logger.warning(
                "pipeline: auto-promote failed for slug=%s workflow=%s",
                result.slug,
                workflow_id,
            )
            return

        logger.info(
            "pipeline: auto-promoted skill id=%s slug=%s for workflow=%s",
            skill_id,
            result.slug,
            workflow_id,
        )

        # --------------------------------------------------------------
        # Step 7: Create DERIVED_FROM edge in Neo4j
        # --------------------------------------------------------------
        await _create_derived_from_edge(
            client=client,
            skill_slug=result.slug,
            skill_id=skill_id,
            workflow_id=workflow_id,
        )

        logger.info(
            "pipeline: completed full pipeline for session=%s workflow=%s "
            "skill=%s",
            session_id,
            workflow_id,
            result.slug,
        )

    except Exception:
        logger.error(
            "pipeline: unexpected error for session=%s",
            session_id,
            exc_info=True,
        )
    finally:
        await client.close()


# ---------------------------------------------------------------------------
# Helper: get conversation goal (inbox conversations only)
# ---------------------------------------------------------------------------


def _get_conversation_goal(session_id: str, tenant_id: str) -> str | None:
    """Try to find a goal from an InboxConversation linked to this session.

    Returns the goal string, or None if the session is not linked to any
    inbox conversation or has no goal.
    """
    try:
        from uuid import UUID

        from sqlalchemy import select

        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.models import InboxConversation, InboxMessage

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            # InboxMessage has a session_id FK pointing to AgentSession.
            # Find the inbox conversation via that link.
            stmt = (
                select(InboxConversation.goal)
                .join(
                    InboxMessage,
                    InboxMessage.conversation_id == InboxConversation.id,
                )
                .where(InboxMessage.session_id == UUID(session_id))
                .limit(1)
            )
            row = db_session.execute(stmt).scalar_one_or_none()
            return row if row else None
    except Exception:
        logger.debug(
            "Could not resolve goal for session %s", session_id, exc_info=True
        )
        return None


# ---------------------------------------------------------------------------
# Helper: write judgment to Neo4j
# ---------------------------------------------------------------------------


async def _write_judgment_to_neo4j(
    client: Neo4jClient,
    judgment: Any,
    session_id: str,
    tenant_id: str,
    user_id: str,
) -> str | None:
    """Write the Judge output to Neo4j as Workflow -> Execution -> Steps.

    Returns the workflow_id on success, or None on failure.
    """
    from onyx.workflow.matcher import _embed_text, match_or_create_workflow

    try:
        # 1. Match or create Workflow using the pattern_summary
        workflow_id, _is_new = await match_or_create_workflow(
            task_name=judgment.pattern_summary,
            user_id=user_id,
            tenant_id=tenant_id,
            agent_session_id=session_id,
            neo4j_client=client,
        )

        # 2. Build Execution node with judgment fields
        exec_id = str(uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()

        # 3. Build Step nodes
        steps: list[dict[str, Any]] = []
        for i, flow_step in enumerate(judgment.flow):
            step_id = str(uuid4())
            embed_text = f"{flow_step.name}: {flow_step.description}"
            try:
                embedding = await _embed_text(embed_text)
            except Exception:
                logger.warning(
                    "pipeline: failed to embed step %s", flow_step.name
                )
                embedding = []

            steps.append({
                "id": step_id,
                "position": i,
                "name": flow_step.name,
                "description": flow_step.description,
                "embedding": embedding,
            })

        # 4. Build Cypher queries for atomic write
        queries: list[tuple[str, dict[str, object]]] = []

        # Create Execution linked to Workflow
        queries.append((
            "MATCH (w:Workflow {id: $wfId}) "
            "CREATE (e:Execution {"
            "  id: $eid,"
            "  agent_session_id: $sid,"
            "  turn_numbers: [1],"
            "  status: $status,"
            "  mode: 'interactive',"
            "  input_summary: '',"
            "  output_summary: '',"
            "  step_count: $stepCount,"
            "  raw_step_count: 0,"
            "  quality: $quality,"
            "  pattern_summary: $patternSummary,"
            "  root_cause: $rootCause,"
            "  confidence: $confidence,"
            "  judged_at: $judgedAt,"
            "  started_at: datetime(),"
            "  created_at: datetime()"
            "}) "
            "CREATE (w)-[:HAS_EXECUTION]->(e)",
            {
                "wfId": workflow_id,
                "eid": exec_id,
                "sid": session_id,
                "status": "completed",
                "stepCount": len(steps),
                "quality": judgment.quality,
                "patternSummary": judgment.pattern_summary,
                "rootCause": judgment.root_cause,
                "confidence": judgment.confidence,
                "judgedAt": now_iso,
            },
        ))

        # Create Step nodes linked to Execution
        for step in steps:
            queries.append((
                "MATCH (e:Execution {id: $eid}) "
                "CREATE (s:Step {"
                "  id: $sid,"
                "  position: $position,"
                "  name: $name,"
                "  description: $description,"
                "  status: 'completed',"
                "  canonical_action: $name,"
                "  node_type: 'compute',"
                "  embedding: $embedding,"
                "  created_at: datetime()"
                "}) "
                "CREATE (e)-[:HAS_STEP]->(s)",
                {
                    "eid": exec_id,
                    "sid": step["id"],
                    "position": step["position"],
                    "name": step["name"],
                    "description": step["description"],
                    "embedding": step["embedding"],
                },
            ))

        # Create NEXT edges between sequential steps
        for i in range(len(steps) - 1):
            queries.append((
                "MATCH (s1:Step {id: $s1id}), (s2:Step {id: $s2id}) "
                "CREATE (s1)-[:NEXT {goal: ''}]->(s2)",
                {
                    "s1id": steps[i]["id"],
                    "s2id": steps[i + 1]["id"],
                },
            ))

        # Update Workflow stats
        queries.append((
            "MATCH (w:Workflow {id: $wfId}) "
            "SET w.execution_count = w.execution_count + 1, "
            "    w.last_run_at = datetime(), "
            "    w.updated_at = datetime(), "
            "    w.pattern_summary = $patternSummary",
            {
                "wfId": workflow_id,
                "patternSummary": judgment.pattern_summary,
            },
        ))

        # 5. Execute all in a single transaction
        await client.execute_write_tx(queries)

        return workflow_id

    except Exception:
        logger.error(
            "pipeline: failed to write judgment to Neo4j",
            exc_info=True,
        )
        return None


# ---------------------------------------------------------------------------
# Helper: proposer check
# ---------------------------------------------------------------------------


async def _proposer_check(
    client: Neo4jClient,
    workflow_id: str,
    quality: str,
) -> tuple[str | None, str | None]:
    """Determine if we should create or edit a skill.

    Returns (action, target_skill_slug) where action is "create", "edit",
    or None (no action needed).
    """
    try:
        # Count executions for this workflow
        count_result = await client.execute_read(
            "MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution) "
            "RETURN count(e) AS cnt",
            {"wfId": workflow_id},
        )
        execution_count = int(count_result[0]["cnt"]) if count_result else 0

        # Check if workflow already has a DERIVED_FROM skill
        skill_result = await client.execute_read(
            "MATCH (sk:SkillNode)-[:DERIVED_FROM]->(w:Workflow {id: $wfId}) "
            "RETURN sk.skill_slug AS slug "
            "LIMIT 1",
            {"wfId": workflow_id},
        )
        has_skill = len(skill_result) > 0
        target_skill_slug: str | None = None
        if has_skill:
            target_skill_slug = str(skill_result[0].get("slug", ""))

        logger.info(
            "pipeline: proposer check workflow=%s exec_count=%d has_skill=%s "
            "quality=%s",
            workflow_id,
            execution_count,
            has_skill,
            quality,
        )

        # Decision logic
        if execution_count >= _MIN_EXECUTIONS_FOR_SKILL and not has_skill:
            return "create", None
        elif has_skill and quality in ("failure", "partial"):
            return "edit", target_skill_slug
        else:
            return None, None

    except Exception:
        logger.warning(
            "pipeline: proposer check failed for workflow=%s",
            workflow_id,
            exc_info=True,
        )
        return None, None


# ---------------------------------------------------------------------------
# Helper: get execution traces for proposer context
# ---------------------------------------------------------------------------


async def _get_execution_traces(
    client: Neo4jClient,
    workflow_id: str,
    limit: int = 5,
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
            "pipeline: failed to fetch execution traces for workflow=%s",
            workflow_id,
            exc_info=True,
        )
        return []


# ---------------------------------------------------------------------------
# Helper: get existing skills as a list of dicts
# ---------------------------------------------------------------------------


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
            "pipeline: failed to load existing skills", exc_info=True
        )
        return []


# ---------------------------------------------------------------------------
# Helper: get feedback history from Neo4j
# ---------------------------------------------------------------------------


async def _get_feedback_history(
    client: Neo4jClient,
    workflow_id: str,
) -> str:
    """Retrieve accumulated feedback history for a workflow.

    Looks for SkillNode annotations or past proposal records stored in
    Neo4j.  Returns a markdown-formatted string, or empty string if none.
    """
    try:
        results = await client.execute_read(
            "MATCH (w:Workflow {id: $wfId})<-[:DERIVED_FROM]-(sk:SkillNode)"
            "-[:HAS_ANNOTATION]->(a:Annotation) "
            "RETURN a.name AS name, a.comment AS comment, "
            "  a.label AS label, a.score AS score "
            "ORDER BY a.created_at DESC "
            "LIMIT 10",
            {"wfId": workflow_id},
        )
        if not results:
            return ""

        lines: list[str] = []
        for r in results:
            name = r.get("name", "?")
            comment = r.get("comment", "")
            label = r.get("label", "")
            score = r.get("score", "")
            lines.append(f"- [{name}] {label} (score={score}): {comment}")

        return "\n".join(lines)
    except Exception:
        logger.debug(
            "pipeline: failed to fetch feedback history for workflow=%s",
            workflow_id,
            exc_info=True,
        )
        return ""


# ---------------------------------------------------------------------------
# Helper: get existing skill instructions (for edit action)
# ---------------------------------------------------------------------------


def _get_existing_skill_instructions(
    skill_slug: str,
    tenant_id: str,
) -> str | None:
    """Load the current instructions for a skill by slug."""
    try:
        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.skills import get_skill_by_slug

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            skill = get_skill_by_slug(skill_slug, db_session)
            if skill:
                return skill.instructions
            return None
    except Exception:
        logger.warning(
            "pipeline: failed to load skill instructions for slug=%s",
            skill_slug,
            exc_info=True,
        )
        return None


# ---------------------------------------------------------------------------
# Helper: auto-promote skill to PostgreSQL
# ---------------------------------------------------------------------------


def _auto_promote_skill(
    result: Any,
    action: str,
    target_skill_slug: str | None,
    tenant_id: str,
) -> int | None:
    """Create or update a skill in PostgreSQL.

    Returns the skill ID on success, or None on failure.
    """
    try:
        from onyx.db.engine.sql_engine import get_session_with_tenant
        from onyx.db.skills import (
            create_skill__no_commit,
            get_skill_by_slug,
            update_skill,
        )

        with get_session_with_tenant(tenant_id=tenant_id) as db_session:
            if action == "create":
                # Check for slug collision first
                existing = get_skill_by_slug(result.slug, db_session)
                if existing:
                    logger.info(
                        "pipeline: skill slug=%s already exists (id=%d), "
                        "updating instead of creating",
                        result.slug,
                        existing.id,
                    )
                    updated = update_skill(
                        skill_id=existing.id,
                        db_session=db_session,
                        name=result.name,
                        description=result.description,
                        instructions=result.instructions,
                    )
                    return updated.id

                skill = create_skill__no_commit(
                    slug=result.slug,
                    name=result.name,
                    description=result.description,
                    instructions=result.instructions,
                    db_session=db_session,
                    enabled=True,
                )
                db_session.commit()
                logger.info(
                    "pipeline: created new skill slug=%s id=%d",
                    skill.slug,
                    skill.id,
                )
                return skill.id

            elif action == "edit" and target_skill_slug:
                existing = get_skill_by_slug(target_skill_slug, db_session)
                if existing is None:
                    logger.warning(
                        "pipeline: target skill slug=%s not found for edit",
                        target_skill_slug,
                    )
                    return None

                updated = update_skill(
                    skill_id=existing.id,
                    db_session=db_session,
                    name=result.name,
                    description=result.description,
                    instructions=result.instructions,
                )
                logger.info(
                    "pipeline: updated skill slug=%s id=%d",
                    target_skill_slug,
                    updated.id,
                )
                return updated.id

            else:
                logger.warning(
                    "pipeline: unknown action=%s or missing target slug",
                    action,
                )
                return None

    except Exception:
        logger.error(
            "pipeline: failed to auto-promote skill", exc_info=True
        )
        return None


# ---------------------------------------------------------------------------
# Helper: create DERIVED_FROM edge in Neo4j
# ---------------------------------------------------------------------------


async def _create_derived_from_edge(
    client: Neo4jClient,
    skill_slug: str,
    skill_id: int | str,
    workflow_id: str,
) -> None:
    """Create or update the (:SkillNode)-[:DERIVED_FROM]->(:Workflow) edge."""
    try:
        await client.execute_write(
            "MERGE (sk:SkillNode {skill_slug: $slug}) "
            "ON CREATE SET "
            "  sk.id = $skId, "
            "  sk.skill_id = $skillId, "
            "  sk.created_at = datetime() "
            "ON MATCH SET "
            "  sk.skill_id = $skillId, "
            "  sk.updated_at = datetime() "
            "WITH sk "
            "MATCH (w:Workflow {id: $wfId}) "
            "MERGE (sk)-[:DERIVED_FROM]->(w)",
            {
                "slug": skill_slug,
                "skId": str(uuid4()),
                "skillId": str(skill_id),
                "wfId": workflow_id,
            },
        )
        logger.info(
            "pipeline: created DERIVED_FROM edge skill=%s -> workflow=%s",
            skill_slug,
            workflow_id,
        )
    except Exception:
        logger.warning(
            "pipeline: failed to create DERIVED_FROM edge",
            exc_info=True,
        )
