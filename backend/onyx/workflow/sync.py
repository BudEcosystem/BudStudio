"""Sync agent turn data to Neo4j workflow graph.

After each agent turn completes (OverallStop is emitted), a Celery task calls
``sync_turn_to_neo4j`` which:

1. Loads the latest turn's ``AgentMessage`` rows from PostgreSQL.
2. Calls the LLM summarizer to produce human-readable steps.
3. Matches or creates a Workflow node in Neo4j (via embedding similarity).
4. Writes Execution, Step, RawStep, and Artifact nodes in a single
   Neo4j transaction.

The function is designed to be **idempotent**: if an Execution already exists
for the given session + turn number, the sync is skipped.
"""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from onyx.db.engine.sql_engine import get_session_with_current_tenant
from onyx.db.enums import AgentMessageRole
from onyx.db.models import AgentMessage
from onyx.workflow.models import (
    ArtifactNode,
    ExecutionNode,
    RawStepNode,
    StepNode,
)
from onyx.workflow.neo4j_client import Neo4jClient
from onyx.workflow.config import NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD
from onyx.workflow.matcher import (
    find_active_execution_in_session,
    match_or_create_workflow,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry point (sync, called from Celery)
# ---------------------------------------------------------------------------


def sync_turn_to_neo4j(
    session_id: str,
    tenant_id: str,
    user_id: str,
) -> None:
    """Sync a completed agent turn to Neo4j.

    Called from a Celery task in a synchronous context.  Internally spins up
    an asyncio event loop because the Neo4j driver and matcher are async.

    Args:
        session_id: The agent session UUID (as string).
        tenant_id: Tenant identifier (set by Celery middleware via contextvar).
        user_id: The user UUID (as string).
    """
    try:
        asyncio.run(_sync_turn_async(session_id, tenant_id, user_id))
    except Exception:
        logger.error(
            "Failed to sync turn to Neo4j for session %s",
            session_id,
            exc_info=True,
        )


# ---------------------------------------------------------------------------
# Internal async implementation
# ---------------------------------------------------------------------------


async def _sync_turn_async(
    session_id: str,
    tenant_id: str,
    user_id: str,
) -> None:
    """Async implementation of the Neo4j sync logic."""

    # 1. Load the latest turn's messages from PostgreSQL
    messages = _load_latest_turn_messages(session_id)
    if not messages:
        logger.warning(
            "No messages found for session %s — skipping sync",
            session_id,
        )
        return

    # 2. Extract structured data from messages
    user_message, tool_calls, assistant_response = _extract_turn_data(messages)

    if not user_message and not tool_calls:
        logger.debug(
            "Empty turn for session %s — skipping sync",
            session_id,
        )
        return

    # Skip trivial turns with no tool calls (agent just responded from context)
    if not tool_calls:
        logger.debug(
            "No tool calls in turn for session %s — skipping sync",
            session_id,
        )
        return

    # 3. Compute a turn number (count of USER messages in the session)
    turn_number = _compute_turn_number(session_id)

    # 4. Create a fresh Neo4j client (avoids event loop conflicts with singleton)
    client = Neo4jClient(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    try:
        await _sync_turn_with_client(
            client, session_id, tenant_id, user_id,
            messages, user_message, tool_calls, assistant_response, turn_number,
        )
    finally:
        await client.close()


async def _sync_turn_with_client(
    client: Neo4jClient,
    session_id: str,
    tenant_id: str,
    user_id: str,
    messages: list[Any],
    user_message: str,
    tool_calls: list[dict[str, Any]],
    assistant_response: str,
    turn_number: int,
) -> None:
    """Core sync logic with an active Neo4j client."""

    # 5. Idempotency check: skip if this turn was already synced
    if await _turn_already_synced(session_id, turn_number, client):
        logger.info(
            "Turn %d already synced for session %s — skipping",
            turn_number,
            session_id,
        )
        return

    # 6. Check if there is already a running Execution for this session
    #    (multi-turn sessions reuse the same Execution)
    existing_exec_id = await find_active_execution_in_session(
        session_id, client
    )
    existing_workflow_name: str | None = None
    existing_canonical_actions: list[str] = []
    if existing_exec_id:
        existing_workflow_name = await _get_workflow_name_for_execution(
            existing_exec_id, client
        )
        if existing_workflow_name:
            existing_canonical_actions = await _get_workflow_canonical_actions(
                existing_workflow_name, user_id, client
            )

    # 7. Summarize the turn using an LLM (falls back to heuristic)
    summary = _summarize_turn(
        user_message=user_message,
        tool_calls=tool_calls,
        assistant_response=assistant_response,
        existing_workflow_name=existing_workflow_name,
        existing_canonical_actions=existing_canonical_actions,
        user_id=user_id,
    )

    # Skip if LLM only produced input/output nodes (no compute work)
    has_compute = any(
        s.node_type == "compute" for s in summary.steps
    )
    if not has_compute:
        logger.debug(
            "No compute nodes in summary for session %s — skipping sync",
            session_id,
        )
        return

    # 8. Match or create a Workflow node
    workflow_id: str
    if existing_exec_id:
        # Reuse the workflow from the existing execution
        wf_id = await _get_workflow_id_for_execution(existing_exec_id, client)
        workflow_id = wf_id if wf_id else (
            await match_or_create_workflow(
                task_name=summary.task_name,
                user_id=user_id,
                tenant_id=tenant_id,
                agent_session_id=session_id,
                neo4j_client=client,
            )
        )[0]
    else:
        workflow_id, _is_new = await match_or_create_workflow(
            task_name=summary.task_name,
            user_id=user_id,
            tenant_id=tenant_id,
            agent_session_id=session_id,
            neo4j_client=client,
        )

    # 9. Build all the graph nodes
    execution = ExecutionNode(
        agent_session_id=session_id,
        turn_numbers=[turn_number],
        status="completed",
        input_summary=user_message[:500],
        output_summary=assistant_response[:500],
        step_count=len(summary.steps),
        raw_step_count=len(tool_calls),
    )

    # Embed step names+descriptions for semantic matching
    from onyx.workflow.matcher import _embed_text

    steps: list[StepNode] = []
    for i, step_summary in enumerate(summary.steps):
        embed_text = f"{step_summary.name}: {step_summary.description}"
        try:
            embedding = await _embed_text(embed_text)
        except Exception:
            logger.warning("Failed to embed step %s, using empty", step_summary.name)
            embedding = []
        steps.append(
            StepNode(
                position=i,
                name=step_summary.name,
                description=step_summary.description,
                canonical_action=step_summary.canonical_action,
                node_type=step_summary.node_type,
                input_source=step_summary.input_source,
                transition_goal=step_summary.transition_goal,
                edge_type=step_summary.edge_type,
                embedding=embedding,
            )
        )

    raw_steps: list[RawStepNode] = []
    for i, tc in enumerate(tool_calls):
        raw_steps.append(
            RawStepNode(
                step_index=i,
                tool_name=tc.get("tool_name", "unknown"),
                tool_source=tc.get("tool_source", "remote"),
                mcp_server=tc.get("mcp_server"),
                inputs=json.dumps(tc.get("tool_input", {}), default=str),
                outputs=json.dumps(tc.get("tool_output", {}), default=str),
                error=tc.get("tool_error"),
                status=tc.get("status", "completed"),
                agent_message_id=tc.get("message_id"),
            )
        )

    # Detect artifacts from render_artifact tool calls
    artifacts: list[tuple[int, ArtifactNode]] = []
    for i, tc in enumerate(tool_calls):
        if tc.get("tool_name") == "render_artifact":
            raw_input = tc.get("tool_input", {})
            if isinstance(raw_input, str):
                try:
                    raw_input = json.loads(raw_input)
                except json.JSONDecodeError:
                    raw_input = {}
            artifacts.append(
                (
                    i,
                    ArtifactNode(
                        artifact_type=raw_input.get("type", "code"),
                        title=raw_input.get("title", "Artifact"),
                        data=json.dumps(raw_input, default=str),
                    ),
                )
            )

    # 10. Build Cypher queries for a single transaction
    queries = _build_cypher_queries(
        workflow_id=workflow_id,
        execution=execution,
        steps=steps,
        raw_steps=raw_steps,
        artifacts=artifacts,
        existing_exec_id=existing_exec_id,
        turn_number=turn_number,
    )

    # 11. Execute all queries in a single transaction
    await client.execute_write_tx(queries)

    logger.info(
        "Synced turn %d to Neo4j: workflow=%s, session=%s, "
        "steps=%d, raw_steps=%d, artifacts=%d",
        turn_number,
        workflow_id,
        session_id,
        len(steps),
        len(raw_steps),
        len(artifacts),
    )


# ---------------------------------------------------------------------------
# PostgreSQL helpers
# ---------------------------------------------------------------------------


def _load_latest_turn_messages(session_id: str) -> list[AgentMessage]:
    """Load messages from the latest turn of the given session.

    A "turn" is defined as the sequence of messages starting from the last
    USER message through all subsequent TOOL and ASSISTANT messages.
    """
    from sqlalchemy import select

    with get_session_with_current_tenant() as db_session:
        # Get all messages ordered by created_at
        stmt = (
            select(AgentMessage)
            .where(AgentMessage.session_id == UUID(session_id))
            .order_by(AgentMessage.created_at)
        )
        all_messages: list[AgentMessage] = list(
            db_session.execute(stmt).scalars().all()
        )

        if not all_messages:
            return []

        # Find the last USER message — that's the start of the latest turn
        last_user_idx: int | None = None
        for i in range(len(all_messages) - 1, -1, -1):
            if all_messages[i].role == AgentMessageRole.USER:
                last_user_idx = i
                break

        if last_user_idx is None:
            return []

        # Return messages from last USER message onward
        turn_messages = all_messages[last_user_idx:]

        # Eagerly load all attributes we need before closing the session
        result: list[AgentMessage] = []
        for msg in turn_messages:
            # Access all lazy-loaded attributes to detach from session
            _ = msg.id
            _ = msg.role
            _ = msg.content
            _ = msg.tool_name
            _ = msg.tool_input
            _ = msg.tool_output
            _ = msg.tool_error
            _ = msg.tool_call_id
            _ = msg.step_number
            _ = msg.created_at
            result.append(msg)

        return result


def _compute_turn_number(session_id: str) -> int:
    """Count the number of USER messages in the session (= turn number)."""
    from sqlalchemy import func, select

    with get_session_with_current_tenant() as db_session:
        stmt = (
            select(func.count())
            .select_from(AgentMessage)
            .where(
                AgentMessage.session_id == UUID(session_id),
                AgentMessage.role == AgentMessageRole.USER,
            )
        )
        count: int = db_session.execute(stmt).scalar_one()
        return count


def _extract_turn_data(
    messages: list[AgentMessage],
) -> tuple[str, list[dict[str, Any]], str]:
    """Extract user message, tool calls, and assistant response from turn messages.

    Returns:
        A tuple of (user_message, tool_calls, assistant_response).
    """
    user_message = ""
    tool_calls: list[dict[str, Any]] = []
    assistant_response = ""

    for msg in messages:
        if msg.role == AgentMessageRole.USER:
            user_message = msg.content or ""

        elif msg.role == AgentMessageRole.TOOL:
            tool_call: dict[str, Any] = {
                "tool_name": msg.tool_name or "unknown",
                "tool_input": msg.tool_input or {},
                "tool_output": msg.tool_output or {},
                "tool_error": msg.tool_error,
                "tool_call_id": msg.tool_call_id,
                "message_id": str(msg.id),
                "step_number": msg.step_number,
                "status": "failed" if msg.tool_error else "completed",
            }
            # Detect tool source from tool_name patterns
            if msg.tool_name and "__" in msg.tool_name:
                # MCP tools have format "mcp_servername__toolname"
                tool_call["tool_source"] = "mcp"
                parts = msg.tool_name.split("__", 1)
                tool_call["mcp_server"] = parts[0]
            else:
                tool_call["tool_source"] = "local"
            tool_calls.append(tool_call)

        elif msg.role == AgentMessageRole.ASSISTANT:
            # Keep the last assistant message as the response
            assistant_response = msg.content or ""

    return user_message, tool_calls, assistant_response


# ---------------------------------------------------------------------------
# LLM summarizer helper
# ---------------------------------------------------------------------------


def _summarize_turn(
    user_message: str,
    tool_calls: list[dict[str, Any]],
    assistant_response: str,
    existing_workflow_name: str | None = None,
    existing_canonical_actions: list[str] | None = None,
    user_id: str | None = None,
) -> "TurnSummary":
    """Call the summarizer to produce human-readable steps.

    Uses the default fast LLM.  Falls back to heuristic if LLM is unavailable.
    """
    from onyx.workflow.models import TurnSummary
    from onyx.workflow.summarizer import summarize_turn_sync

    try:
        from onyx.llm.factory import get_default_llms
        from onyx.db.models import User

        # Load User object from PG so Bud Foundry provider can get OAuth token
        user_obj: User | None = None
        if user_id:
            try:
                with get_session_with_current_tenant() as db_session:
                    user_obj = db_session.query(User).filter(
                        User.id == user_id
                    ).first()
            except Exception:
                logger.debug("Could not load user for LLM auth, proceeding without")

        _main_llm, fast_llm = get_default_llms(
            temperature=0.0,
            timeout=15,
            user=user_obj,
        )
    except Exception:
        logger.warning(
            "Could not obtain default LLM for workflow summarizer — "
            "using fallback summary",
            exc_info=True,
        )
        from onyx.workflow.summarizer import _build_default_summary

        return _build_default_summary(
            user_message, tool_calls, existing_workflow_name
        )

    return summarize_turn_sync(
        llm=fast_llm,
        user_message=user_message,
        tool_calls=tool_calls,
        assistant_response=assistant_response,
        existing_workflow_name=existing_workflow_name,
        existing_canonical_actions=existing_canonical_actions,
    )


# ---------------------------------------------------------------------------
# Neo4j helpers
# ---------------------------------------------------------------------------


async def _turn_already_synced(
    session_id: str,
    turn_number: int,
    client: Neo4jClient,
) -> bool:
    """Check whether this turn was already written to Neo4j."""
    query = (
        "MATCH (e:Execution {agent_session_id: $sid}) "
        "WHERE $turnNumber IN e.turn_numbers "
        "RETURN e.id AS id "
        "LIMIT 1"
    )
    try:
        results = await client.execute_read(
            query, {"sid": session_id, "turnNumber": turn_number}
        )
        return len(results) > 0
    except Exception:
        logger.warning(
            "Failed to check idempotency for session %s turn %d",
            session_id,
            turn_number,
            exc_info=True,
        )
        return False


async def _get_workflow_name_for_execution(
    execution_id: str,
    client: Neo4jClient,
) -> str | None:
    """Get the Workflow name linked to an Execution."""
    query = (
        "MATCH (w:Workflow)-[:HAS_EXECUTION]->(e:Execution {id: $eid}) "
        "RETURN w.name AS name "
        "LIMIT 1"
    )
    try:
        results = await client.execute_read(query, {"eid": execution_id})
        if results:
            return str(results[0]["name"])
        return None
    except Exception:
        return None


async def _get_workflow_canonical_actions(
    workflow_name: str,
    user_id: str,
    client: Neo4jClient,
) -> list[str]:
    """Get distinct canonical_actions used in a workflow's existing executions."""
    query = (
        "MATCH (w:Workflow {name: $name, user_id: $userId})"
        "-[:HAS_EXECUTION]->(e:Execution)-[:HAS_STEP]->(s:Step) "
        "RETURN DISTINCT s.canonical_action AS action"
    )
    try:
        results = await client.execute_read(
            query, {"name": workflow_name, "userId": user_id}
        )
        return [str(r["action"]) for r in results if r.get("action")]
    except Exception:
        return []


async def _get_workflow_id_for_execution(
    execution_id: str,
    client: Neo4jClient,
) -> str | None:
    """Get the Workflow ID linked to an Execution."""
    query = (
        "MATCH (w:Workflow)-[:HAS_EXECUTION]->(e:Execution {id: $eid}) "
        "RETURN w.id AS id "
        "LIMIT 1"
    )
    try:
        results = await client.execute_read(query, {"eid": execution_id})
        if results:
            return str(results[0]["id"])
        return None
    except Exception:
        return None


def _build_cypher_queries(
    workflow_id: str,
    execution: ExecutionNode,
    steps: list[StepNode],
    raw_steps: list[RawStepNode],
    artifacts: list[tuple[int, ArtifactNode]],
    existing_exec_id: str | None,
    turn_number: int,
) -> list[tuple[str, dict[str, object]]]:
    """Build the list of (cypher_query, params) for a single transaction.

    Handles two cases:
    - **New execution**: creates Execution + links to Workflow.
    - **Existing execution**: appends turn_number to the existing Execution.

    In both cases, Steps, RawSteps, and Artifacts are created and linked.
    """
    queries: list[tuple[str, dict[str, object]]] = []

    # -- Execution node -------------------------------------------------
    if existing_exec_id:
        # Append turn to existing execution
        queries.append((
            "MATCH (e:Execution {id: $eid}) "
            "SET e.turn_numbers = e.turn_numbers + $turnNumber, "
            "    e.step_count = e.step_count + $newSteps, "
            "    e.raw_step_count = e.raw_step_count + $newRawSteps, "
            "    e.output_summary = $outputSummary",
            {
                "eid": existing_exec_id,
                "turnNumber": turn_number,
                "newSteps": len(steps),
                "newRawSteps": len(raw_steps),
                "outputSummary": execution.output_summary,
            },
        ))
        exec_id = existing_exec_id
    else:
        # Create new Execution + link to Workflow
        exec_id = execution.id
        queries.append((
            "MATCH (w:Workflow {id: $wfId}) "
            "CREATE (e:Execution {"
            "  id: $eid,"
            "  agent_session_id: $sid,"
            "  turn_numbers: $turnNumbers,"
            "  status: $status,"
            "  mode: $mode,"
            "  input_summary: $inputSummary,"
            "  output_summary: $outputSummary,"
            "  step_count: $stepCount,"
            "  raw_step_count: $rawStepCount,"
            "  started_at: datetime(),"
            "  created_at: datetime()"
            "}) "
            "CREATE (w)-[:HAS_EXECUTION]->(e)",
            {
                "wfId": workflow_id,
                "eid": exec_id,
                "sid": execution.agent_session_id,
                "turnNumbers": execution.turn_numbers,
                "status": execution.status,
                "mode": execution.mode,
                "inputSummary": execution.input_summary,
                "outputSummary": execution.output_summary,
                "stepCount": execution.step_count,
                "rawStepCount": execution.raw_step_count,
            },
        ))

    # -- Step nodes + edges ----------------------------------------
    import re as _re_labels

    _VALID_NODE_TYPES = {"input": "Input", "compute": "Compute", "output": "Output"}

    for i, step in enumerate(steps):
        # Dynamic Neo4j label based on node_type
        type_label = _VALID_NODE_TYPES.get(step.node_type, "Compute")
        queries.append((
            "MATCH (e:Execution {id: $eid}) "
            f"CREATE (s:Step:{type_label} {{"
            "  id: $sid,"
            "  position: $position,"
            "  name: $name,"
            "  description: $description,"
            "  status: $status,"
            "  canonical_action: $canonicalAction,"
            "  node_type: $nodeType,"
            "  input_source: $inputSource,"
            "  embedding: $embedding,"
            "  created_at: datetime()"
            "}) "
            "CREATE (e)-[:HAS_STEP]->(s)",
            {
                "eid": exec_id,
                "sid": step.id,
                "position": step.position,
                "name": step.name,
                "description": step.description,
                "status": step.status,
                "canonicalAction": step.canonical_action,
                "nodeType": step.node_type,
                "inputSource": step.input_source or "",
                "embedding": step.embedding,
            },
        ))

    # Edges between sequential steps with dynamic relationship types
    import re as _re

    for i in range(len(steps) - 1):
        goal = steps[i].transition_goal or ""
        # Sanitize edge_type to valid Neo4j relationship type
        raw_type = steps[i].edge_type or "NEXT"
        edge_type = _re.sub(r"[^A-Z0-9_]", "", raw_type.upper().replace(" ", "_"))
        if not edge_type:
            edge_type = "NEXT"
        queries.append((
            "MATCH (s1:Step {id: $s1id}), (s2:Step {id: $s2id}) "
            f"CREATE (s1)-[:{edge_type} {{goal: $goal}}]->(s2)",
            {
                "s1id": steps[i].id,
                "s2id": steps[i + 1].id,
                "goal": goal,
            },
        ))

    # -- RawStep nodes + RAW_NEXT edges ---------------------------------
    # Assign each raw step to the nearest logical step by position
    step_ids = [s.id for s in steps]
    for i, rs in enumerate(raw_steps):
        # Map raw step index to closest logical step
        parent_step_id: str | None = None
        if step_ids:
            # Distribute raw steps across logical steps proportionally
            step_idx = min(
                int(i * len(steps) / max(len(raw_steps), 1)),
                len(steps) - 1,
            )
            parent_step_id = step_ids[step_idx]

        # Create RawStep — always pass mcp_server and error as params;
        # Neo4j stores null values without issue.
        rs_params: dict[str, object] = {
            "rsid": rs.id,
            "stepIndex": rs.step_index,
            "toolName": rs.tool_name,
            "toolSource": rs.tool_source,
            "mcpServer": rs.mcp_server,
            "inputs": rs.inputs,
            "outputs": rs.outputs,
            "error": rs.error,
            "status": rs.status,
            "agentMessageId": rs.agent_message_id,
        }

        raw_step_cypher = (
            "CREATE (rs:RawStep {"
            "  id: $rsid,"
            "  step_index: $stepIndex,"
            "  tool_name: $toolName,"
            "  tool_source: $toolSource,"
            "  mcp_server: $mcpServer,"
            "  error: $error,"
            "  inputs: $inputs,"
            "  outputs: $outputs,"
            "  status: $status,"
            "  agent_message_id: $agentMessageId,"
            "  created_at: datetime()"
            "}) "
        )

        # Build RawStep creation + link to parent Step
        if parent_step_id:
            queries.append((
                "MATCH (s:Step {id: $parentStepId}) "
                + raw_step_cypher
                + "CREATE (s)-[:HAS_RAW]->(rs)",
                {**rs_params, "parentStepId": parent_step_id},
            ))
        else:
            # No logical steps — link directly to execution
            queries.append((
                "MATCH (e:Execution {id: $eid}) "
                + raw_step_cypher
                + "CREATE (e)-[:HAS_RAW]->(rs)",
                {**rs_params, "eid": exec_id},
            ))

    # RAW_NEXT edges between sequential raw steps
    for i in range(len(raw_steps) - 1):
        queries.append((
            "MATCH (rs1:RawStep {id: $rs1id}), (rs2:RawStep {id: $rs2id}) "
            "CREATE (rs1)-[:RAW_NEXT]->(rs2)",
            {
                "rs1id": raw_steps[i].id,
                "rs2id": raw_steps[i + 1].id,
            },
        ))

    # -- Artifact nodes -------------------------------------------------
    for raw_step_idx, artifact in artifacts:
        if raw_step_idx < len(raw_steps):
            queries.append((
                "MATCH (rs:RawStep {id: $rsid}) "
                "CREATE (a:Artifact {"
                "  id: $aid,"
                "  artifact_type: $artifactType,"
                "  title: $title,"
                "  data: $data,"
                "  created_at: datetime()"
                "}) "
                "CREATE (rs)-[:PRODUCED]->(a)",
                {
                    "rsid": raw_steps[raw_step_idx].id,
                    "aid": artifact.id,
                    "artifactType": artifact.artifact_type,
                    "title": artifact.title,
                    "data": artifact.data,
                },
            ))

    # -- Update Workflow stats ------------------------------------------
    queries.append((
        "MATCH (w:Workflow {id: $wfId}) "
        "SET w.execution_count = w.execution_count + CASE WHEN $isNew THEN 1 ELSE 0 END, "
        "    w.last_run_at = datetime(), "
        "    w.updated_at = datetime()",
        {
            "wfId": workflow_id,
            "isNew": existing_exec_id is None,
        },
    ))

    return queries
