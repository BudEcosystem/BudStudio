"""Workflow canvas API endpoints.

Provides read/write access to workflow data stored in Neo4j for the
React Flow canvas frontend. All endpoints require authentication.
"""

from datetime import datetime
from typing import Any
from uuid import uuid4

from fastapi import APIRouter
from fastapi import Depends
from fastapi import HTTPException
from fastapi import Query

from onyx.auth.users import current_admin_user
from onyx.auth.users import current_user
from onyx.db.models import User
from onyx.utils.logger import setup_logger
from onyx.workflow.models import AnnotationInput
from onyx.workflow.neo4j_client import get_neo4j_client
from onyx.workflow.neo4j_client import Neo4jClient

logger = setup_logger()

router = APIRouter(prefix="/workflow", tags=["Workflow"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_client_or_503() -> Neo4jClient:
    """Return the Neo4j client, raising 503 if it is unreachable."""
    try:
        client = await get_neo4j_client()
    except Exception as e:
        logger.error("Failed to obtain Neo4j client: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Workflow service unavailable: cannot connect to Neo4j",
        )
    healthy = await client.health_check()
    if not healthy:
        raise HTTPException(
            status_code=503,
            detail="Workflow service unavailable: Neo4j is not reachable",
        )
    return client


def _user_id_from(user: User | None) -> str:
    """Extract a string user id, raising 401 when auth is required but missing."""
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return str(user.id)


# ---------------------------------------------------------------------------
# 1. List workflows (canvas main page)
# ---------------------------------------------------------------------------


@router.get("")
async def list_workflows(
    min_executions: int = Query(default=2),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    user: User | None = Depends(current_user),
) -> list[dict[str, Any]]:
    """List workflows with min_executions threshold.

    Default min_executions=2 returns only repeated workflows.
    """
    user_id = _user_id_from(user)
    client = await _get_client_or_503()
    results = await client.execute_read(
        """
        MATCH (w:Workflow {user_id: $userId})
        WHERE w.execution_count >= $minExec
        RETURN w
        ORDER BY w.last_run_at DESC
        SKIP $offset LIMIT $limit
        """,
        {
            "userId": user_id,
            "minExec": min_executions,
            "offset": offset,
            "limit": limit,
        },
    )
    return [record["w"] for record in results]


# ---------------------------------------------------------------------------
# 1b. Unified canvas (all workflows on one canvas)
# ---------------------------------------------------------------------------


@router.get("/canvas")
async def get_unified_canvas(
    min_executions: int = Query(default=2),
    user: User | None = Depends(current_user),
) -> dict[str, Any]:
    """Return ALL workflows' aggregated graph in one response for the unified canvas.

    Returns:
      - workflows: list of Workflow node properties
      - nodes: React Flow nodes (prefixed with workflow_id to avoid collisions)
      - edges: React Flow edges from real [:NEXT] relationships
      - shared_actions: canonical_actions appearing in 2+ workflows
    """
    user_id = _user_id_from(user)
    client = await _get_client_or_503()

    # Fetch top 20 qualifying workflows by execution count
    wf_rows = await client.execute_read(
        """
        MATCH (w:Workflow {user_id: $userId})
        WHERE w.execution_count >= $minExec
        RETURN w
        ORDER BY w.execution_count DESC, w.last_run_at DESC
        LIMIT 20
        """,
        {"userId": user_id, "minExec": min_executions},
    )
    workflows: list[dict[str, Any]] = [r["w"] for r in wf_rows]

    if not workflows:
        return {
            "workflows": [],
            "nodes": [],
            "edges": [],
            "shared_actions": [],
        }

    # Fetch aggregated nodes (per workflow x canonical_action) with embeddings
    node_rows = await client.execute_read(
        """
        MATCH (w:Workflow {user_id: $userId})-[:HAS_EXECUTION]->(e:Execution)
              -[:HAS_STEP]->(s:Step)
        WHERE w.execution_count >= $minExec
        WITH w, s.canonical_action AS action,
             collect(s) AS steps, count(DISTINCT e) AS exec_count
        RETURN w.id AS workflow_id, w.name AS workflow_name, action,
               head(steps).name AS name,
               head(steps).description AS description,
               head(steps).status AS status,
               head(steps).duration_ms AS avg_duration_ms,
               head(steps).embedding AS embedding,
               head(steps).node_type AS node_type,
               head(steps).input_source AS input_source,
               size(steps) AS frequency, exec_count
        """,
        {"userId": user_id, "minExec": min_executions},
    )

    # -- Build raw nodes ------------------------------------------------
    import numpy as np

    _STEP_SIMILARITY_THRESHOLD = 0.85

    raw_nodes: list[dict[str, Any]] = []
    node_embeddings: dict[str, list[float]] = {}  # node_id -> embedding
    action_to_workflows: dict[str, set[str]] = {}

    for row in node_rows:
        wf_id: str = row["workflow_id"]
        action: str = row["action"]
        node_id = f"wf-{wf_id}-{action}"
        embedding: list[float] | None = row.get("embedding")

        action_to_workflows.setdefault(action, set()).add(wf_id)

        raw_nodes.append(
            {
                "id": node_id,
                "type": "workflowStep",
                "position": {"x": 0, "y": 0},
                "data": {
                    "workflow_id": wf_id,
                    "workflow_name": row["workflow_name"],
                    "canonical_action": action,
                    "name": row["name"] or action,
                    "description": row["description"] or "",
                    "frequency": row["frequency"],
                    "total_executions": row["exec_count"],
                    "status": row["status"] or "completed",
                    "avg_duration_ms": row["avg_duration_ms"] or 0,
                    "node_type": row.get("node_type") or "compute",
                    "input_source": row.get("input_source") or None,
                },
            }
        )
        if embedding:
            node_embeddings[node_id] = embedding

    # -- Merge semantically similar nodes within same workflow ----------
    # Build merge map: node_id -> canonical merged node_id
    merge_map: dict[str, str] = {}
    wf_groups: dict[str, list[dict[str, Any]]] = {}
    for node in raw_nodes:
        wid = node["data"]["workflow_id"]
        wf_groups.setdefault(wid, []).append(node)

    for wid, wf_nodes in wf_groups.items():
        # Compare all pairs within the workflow
        for i, n1 in enumerate(wf_nodes):
            if n1["id"] in merge_map:
                continue
            emb1 = node_embeddings.get(n1["id"])
            if not emb1:
                continue
            a1 = np.array(emb1, dtype=np.float64)
            norm1 = float(np.linalg.norm(a1))
            if norm1 < 1e-10:
                continue
            for j in range(i + 1, len(wf_nodes)):
                n2 = wf_nodes[j]
                if n2["id"] in merge_map:
                    continue
                emb2 = node_embeddings.get(n2["id"])
                if not emb2:
                    continue
                a2 = np.array(emb2, dtype=np.float64)
                norm2 = float(np.linalg.norm(a2))
                if norm2 < 1e-10:
                    continue
                sim = float(np.dot(a1, a2)) / (norm1 * norm2)
                if sim >= _STEP_SIMILARITY_THRESHOLD:
                    # Merge n2 into n1
                    merge_map[n2["id"]] = n1["id"]
                    # Accumulate frequency
                    n1["data"]["frequency"] += n2["data"]["frequency"]

    # Apply merge: filter out merged nodes, rewrite edge references
    nodes: list[dict[str, Any]] = [
        n for n in raw_nodes if n["id"] not in merge_map
    ]

    # Fetch edges between steps (dynamic relationship types)
    edge_rows = await client.execute_read(
        """
        MATCH (w:Workflow {user_id: $userId})-[:HAS_EXECUTION]->(e:Execution)
              -[:HAS_STEP]->(s1:Step)-[r]->(s2:Step)
        WHERE w.execution_count >= $minExec
          AND NOT type(r) IN ['HAS_STEP', 'HAS_EXECUTION', 'HAS_RAW',
                              'PRODUCED', 'ANNOTATES']
        RETURN w.id AS workflow_id,
               s1.canonical_action AS from_action,
               s2.canonical_action AS to_action,
               count(*) AS frequency,
               collect(DISTINCT r.goal) AS goals,
               collect(DISTINCT type(r)) AS edge_types
        """,
        {"userId": user_id, "minExec": min_executions},
    )

    edges: list[dict[str, Any]] = []
    seen_edges: set[str] = set()
    for row in edge_rows:
        wf_id = row["workflow_id"]
        from_action = row["from_action"]
        to_action = row["to_action"]
        edge_key = f"{wf_id}-{from_action}->{to_action}"
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        goals: list[str] = row.get("goals", []) or []
        goal = next((g for g in goals if g), "")
        edge_types: list[str] = row.get("edge_types", []) or []
        # Pick the most descriptive edge type (not NEXT)
        edge_type = next(
            (t for t in edge_types if t and t != "NEXT"), "NEXT"
        )
        edges.append(
            {
                "id": f"edge-{wf_id}-{from_action}-{to_action}",
                "source": f"wf-{wf_id}-{from_action}",
                "target": f"wf-{wf_id}-{to_action}",
                "type": "workflowEdge",
                "data": {
                    "frequency": row["frequency"],
                    "workflow_id": wf_id,
                    "goal": goal,
                    "edge_type": edge_type,
                },
            }
        )

    # Fallback: for workflows with no [:NEXT] edges, add sequential edges
    wf_ids_with_edges: set[str] = {row["workflow_id"] for row in edge_rows}
    wf_node_map: dict[str, list[dict[str, Any]]] = {}
    for node in nodes:
        wid = node["data"]["workflow_id"]
        wf_node_map.setdefault(wid, []).append(node)

    for wid, wf_nodes in wf_node_map.items():
        if wid in wf_ids_with_edges:
            continue
        if len(wf_nodes) < 2:
            continue
        sorted_wf_nodes = sorted(wf_nodes, key=lambda n: n["data"]["name"])
        for i in range(len(sorted_wf_nodes) - 1):
            src = sorted_wf_nodes[i]
            tgt = sorted_wf_nodes[i + 1]
            edges.append(
                {
                    "id": f"edge-{wid}-fallback-{i}",
                    "source": src["id"],
                    "target": tgt["id"],
                    "type": "workflowEdge",
                    "data": {
                        "frequency": 1,
                        "workflow_id": wid,
                    },
                }
            )

    # Apply merge_map to edge source/target references
    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        if src in merge_map:
            edge["source"] = merge_map[src]
        if tgt in merge_map:
            edge["target"] = merge_map[tgt]

    # Deduplicate edges after merging (same source+target)
    deduped_edges: list[dict[str, Any]] = []
    deduped_keys: set[str] = set()
    for edge in edges:
        key = f"{edge['source']}->{edge['target']}"
        if key in deduped_keys:
            continue
        deduped_keys.add(key)
        deduped_edges.append(edge)
    edges = deduped_edges

    # -- Cross-workflow edges for semantically similar steps --------
    _CROSS_WF_THRESHOLD = 0.9
    node_ids = [n["id"] for n in nodes]
    for i, nid1 in enumerate(node_ids):
        emb1 = node_embeddings.get(nid1)
        if not emb1:
            continue
        wid1 = nodes[i]["data"]["workflow_id"]
        a1 = np.array(emb1, dtype=np.float64)
        norm1 = float(np.linalg.norm(a1))
        if norm1 < 1e-10:
            continue
        for j in range(i + 1, len(node_ids)):
            nid2 = node_ids[j]
            wid2 = nodes[j]["data"]["workflow_id"]
            if wid1 == wid2:
                continue  # Same workflow — already handled
            emb2 = node_embeddings.get(nid2)
            if not emb2:
                continue
            a2 = np.array(emb2, dtype=np.float64)
            norm2 = float(np.linalg.norm(a2))
            if norm2 < 1e-10:
                continue
            sim = float(np.dot(a1, a2)) / (norm1 * norm2)
            if sim >= _CROSS_WF_THRESHOLD:
                cross_key = f"{nid1}->{nid2}"
                if cross_key not in deduped_keys:
                    deduped_keys.add(cross_key)
                    edges.append(
                        {
                            "id": f"cross-{nid1}-{nid2}",
                            "source": nid1,
                            "target": nid2,
                            "type": "workflowEdge",
                            "data": {
                                "frequency": 1,
                                "edge_type": "SIMILAR_ACTION",
                                "goal": "Semantically similar step across workflows",
                            },
                        }
                    )

    # Shared actions (canonical_actions in 2+ workflows)
    shared_actions = [
        action
        for action, wf_set in action_to_workflows.items()
        if len(wf_set) >= 2
    ]

    return {
        "workflows": workflows,
        "nodes": nodes,
        "edges": edges,
        "shared_actions": shared_actions,
    }


# ---------------------------------------------------------------------------
# 2. Get workflow detail (main canvas data)
# ---------------------------------------------------------------------------


@router.get("/{workflow_id}")
async def get_workflow_detail(
    workflow_id: str,
    user: User | None = Depends(current_user),
) -> dict[str, Any]:
    """Get full workflow with executions, steps, and edges for React Flow canvas.

    Returns a structure with:
      - workflow: the Workflow node properties
      - executions: list of Execution nodes
      - nodes: React Flow node objects (type="workflowStep")
      - edges: React Flow edge objects (type="workflowEdge")
    """
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    # Fetch workflow
    wf_rows = await client.execute_read(
        "MATCH (w:Workflow {id: $wfId}) RETURN w",
        {"wfId": workflow_id},
    )
    if not wf_rows:
        raise HTTPException(status_code=404, detail="Workflow not found")
    workflow: dict[str, Any] = wf_rows[0]["w"]

    # Fetch executions
    exec_rows = await client.execute_read(
        """
        MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution)
        RETURN e
        ORDER BY e.started_at DESC
        """,
        {"wfId": workflow_id},
    )
    executions: list[dict[str, Any]] = [r["e"] for r in exec_rows]

    # Fetch all steps across executions
    step_rows = await client.execute_read(
        """
        MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution)
              -[:HAS_STEP]->(s:Step)
        RETURN e.id AS execution_id, s
        ORDER BY s.position
        """,
        {"wfId": workflow_id},
    )

    # Group steps by canonical_action for frequency counts
    action_counts: dict[str, int] = {}
    action_data: dict[str, dict[str, Any]] = {}
    for row in step_rows:
        step: dict[str, Any] = row["s"]
        action = step.get("canonical_action", "unknown")
        action_counts[action] = action_counts.get(action, 0) + 1
        # Keep the first step data per canonical action as representative
        if action not in action_data:
            action_data[action] = step

    # Build React Flow nodes from canonical actions (one node per unique action)
    nodes: list[dict[str, Any]] = []
    sorted_actions = sorted(
        action_data.keys(),
        key=lambda a: action_data[a].get("position", 0),
    )
    for idx, action in enumerate(sorted_actions):
        representative_step = action_data[action]
        nodes.append(
            {
                "id": f"step-{action}",
                "type": "workflowStep",
                "position": {"x": 0, "y": idx * 120},
                "data": {
                    "canonical_action": action,
                    "name": representative_step.get("name", action),
                    "description": representative_step.get("description", ""),
                    "frequency": action_counts[action],
                    "total_executions": len(executions),
                    "status": representative_step.get("status", "completed"),
                    "avg_duration_ms": representative_step.get("duration_ms", 0),
                },
            }
        )

    # Build React Flow edges from step relationships
    edge_rows = await client.execute_read(
        """
        MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution)
              -[:HAS_STEP]->(s1:Step)-[r]->(s2:Step)
        WHERE NOT type(r) IN ['HAS_STEP', 'HAS_EXECUTION', 'HAS_RAW',
                              'PRODUCED', 'ANNOTATES']
        RETURN s1.canonical_action AS from_action,
               s2.canonical_action AS to_action,
               count(*) AS frequency,
               collect(DISTINCT r.goal) AS goals,
               collect(DISTINCT type(r)) AS edge_types
        """,
        {"wfId": workflow_id},
    )
    edges: list[dict[str, Any]] = []
    seen_edges: set[str] = set()
    for row in edge_rows:
        from_action: str = row["from_action"]
        to_action: str = row["to_action"]
        edge_key = f"{from_action}->{to_action}"
        if edge_key in seen_edges:
            continue
        seen_edges.add(edge_key)
        goals: list[str] = row.get("goals", []) or []
        goal = next((g for g in goals if g), "")
        edge_types: list[str] = row.get("edge_types", []) or []
        edge_type = next(
            (t for t in edge_types if t and t != "NEXT"), "NEXT"
        )
        edge_id = f"edge-{from_action}-{to_action}"
        edges.append(
            {
                "id": edge_id,
                "source": f"step-{from_action}",
                "target": f"step-{to_action}",
                "type": "workflowEdge",
                "data": {
                    "frequency": row["frequency"],
                    "goal": goal,
                    "edge_type": edge_type,
                },
            }
        )

    # Fallback: if no [:NEXT] edges found, use sequential ordering
    if not edges and len(sorted_actions) > 1:
        for i in range(len(sorted_actions) - 1):
            source_action = sorted_actions[i]
            target_action = sorted_actions[i + 1]
            edge_id = f"edge-{source_action}-{target_action}"
            edges.append(
                {
                    "id": edge_id,
                    "source": f"step-{source_action}",
                    "target": f"step-{target_action}",
                    "type": "workflowEdge",
                    "data": {"frequency": len(executions)},
                }
            )

    return {
        "workflow": workflow,
        "executions": executions,
        "nodes": nodes,
        "edges": edges,
    }


# ---------------------------------------------------------------------------
# 3. Get execution detail
# ---------------------------------------------------------------------------


@router.get("/execution/{execution_id}")
async def get_execution_detail(
    execution_id: str,
    user: User | None = Depends(current_user),
) -> dict[str, Any]:
    """Get a single execution with its steps, raw steps, and artifacts."""
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    # Fetch execution
    exec_rows = await client.execute_read(
        "MATCH (e:Execution {id: $id}) RETURN e",
        {"id": execution_id},
    )
    if not exec_rows:
        raise HTTPException(status_code=404, detail="Execution not found")
    execution: dict[str, Any] = exec_rows[0]["e"]

    # Fetch steps with optional raw steps and artifacts
    step_rows = await client.execute_read(
        """
        MATCH (e:Execution {id: $id})-[:HAS_STEP]->(s:Step)
        OPTIONAL MATCH (s)-[:HAS_RAW]->(rs:RawStep)
        OPTIONAL MATCH (rs)-[:PRODUCED]->(a:Artifact)
        RETURN s, rs, a
        ORDER BY s.position, rs.step_index
        """,
        {"id": execution_id},
    )

    # Assemble steps with nested raw steps and artifacts
    steps_map: dict[str, dict[str, Any]] = {}
    for row in step_rows:
        step: dict[str, Any] = row["s"]
        raw_step: dict[str, Any] | None = row.get("rs")
        artifact: dict[str, Any] | None = row.get("a")

        step_id: str = step.get("id", "")
        if step_id not in steps_map:
            steps_map[step_id] = {
                **step,
                "raw_steps": [],
                "_raw_ids_seen": set(),
            }

        if raw_step:
            rs_id: str = raw_step.get("id", "")
            if rs_id not in steps_map[step_id]["_raw_ids_seen"]:
                steps_map[step_id]["_raw_ids_seen"].add(rs_id)
                raw_entry: dict[str, Any] = {**raw_step, "artifacts": []}
                steps_map[step_id]["raw_steps"].append(raw_entry)
            if artifact:
                # Append artifact to the last matching raw step
                for rs_entry in steps_map[step_id]["raw_steps"]:
                    if rs_entry.get("id") == rs_id:
                        rs_entry["artifacts"].append(artifact)
                        break

    # Remove internal tracking sets before returning
    steps_list: list[dict[str, Any]] = []
    for s in steps_map.values():
        s.pop("_raw_ids_seen", None)
        steps_list.append(s)
    steps_list.sort(key=lambda s: s.get("position", 0))

    return {
        "execution": execution,
        "steps": steps_list,
    }


# ---------------------------------------------------------------------------
# 4. Get raw steps for a step (drill-down)
# ---------------------------------------------------------------------------


@router.get("/step/{step_id}/raw")
async def get_step_raw_steps(
    step_id: str,
    user: User | None = Depends(current_user),
) -> list[dict[str, Any]]:
    """Get raw tool-level steps under a human-readable step."""
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    rows = await client.execute_read(
        """
        MATCH (s:Step {id: $id})-[:HAS_RAW]->(rs:RawStep)
        OPTIONAL MATCH (rs)-[:PRODUCED]->(a:Artifact)
        RETURN rs, collect(a) AS artifacts
        ORDER BY rs.step_index
        """,
        {"id": step_id},
    )
    if not rows:
        raise HTTPException(
            status_code=404, detail="Step not found or has no raw steps"
        )

    result: list[dict[str, Any]] = []
    for row in rows:
        raw_step: dict[str, Any] = row["rs"]
        artifacts_raw: list[Any] = row.get("artifacts", [])
        # Filter out None values from collected artifacts
        artifacts: list[dict[str, Any]] = [
            a for a in artifacts_raw if a is not None
        ]
        result.append({**raw_step, "artifacts": artifacts})
    return result


# ---------------------------------------------------------------------------
# 5. Get alternatives for a canonical action
# ---------------------------------------------------------------------------


@router.get("/{workflow_id}/alternatives/{canonical_action}")
async def get_alternatives(
    workflow_id: str,
    canonical_action: str,
    user: User | None = Depends(current_user),
) -> list[dict[str, Any]]:
    """Show how different executions handled the same logical step."""
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    rows = await client.execute_read(
        """
        MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution)
              -[:HAS_STEP]->(s:Step {canonical_action: $action})
        OPTIONAL MATCH (s)-[:HAS_RAW]->(rs:RawStep)
        WITH e, s, collect(rs.tool_name) AS tools_used
        RETURN e.id AS execution_id,
               e.input_summary AS input_summary,
               e.status AS execution_status,
               s.id AS step_id,
               s.name AS step_name,
               s.status AS step_status,
               s.duration_ms AS duration_ms,
               tools_used
        ORDER BY s.duration_ms ASC
        """,
        {"wfId": workflow_id, "action": canonical_action},
    )
    return rows


# ---------------------------------------------------------------------------
# 6. Golden path
# ---------------------------------------------------------------------------


@router.get("/{workflow_id}/golden-path")
async def get_golden_path(
    workflow_id: str,
    user: User | None = Depends(current_user),
) -> list[dict[str, Any]]:
    """Get top-5 most common step sequences across executions."""
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    rows = await client.execute_read(
        """
        MATCH (w:Workflow {id: $wfId})-[:HAS_EXECUTION]->(e:Execution)
              -[:HAS_STEP]->(s:Step)
        WITH e, s
        ORDER BY s.position
        WITH e, collect(s.canonical_action) AS path
        WITH path, count(*) AS frequency
        RETURN path, frequency
        ORDER BY frequency DESC
        LIMIT 5
        """,
        {"wfId": workflow_id},
    )
    return rows


# ---------------------------------------------------------------------------
# 7. Step annotations
# ---------------------------------------------------------------------------


@router.get("/step/{step_id}/annotations")
async def get_step_annotations(
    step_id: str,
    user: User | None = Depends(current_user),
) -> list[dict[str, Any]]:
    """Get all annotations on a step."""
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    rows = await client.execute_read(
        """
        MATCH (an:Annotation)-[:ANNOTATES]->(s:Step {id: $id})
        RETURN an
        ORDER BY an.created_at DESC
        """,
        {"id": step_id},
    )
    return [r["an"] for r in rows]


@router.post("/step/{step_id}/annotate")
async def annotate_step(
    step_id: str,
    annotation: AnnotationInput,
    user: User | None = Depends(current_user),
) -> dict[str, Any]:
    """Add an annotation to a step."""
    user_id = _user_id_from(user)
    client = await _get_client_or_503()

    # Verify step exists
    step_check = await client.execute_read(
        "MATCH (s:Step {id: $id}) RETURN s.id AS id",
        {"id": step_id},
    )
    if not step_check:
        raise HTTPException(status_code=404, detail="Step not found")

    annotation_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    rows = await client.execute_write(
        """
        MATCH (s:Step {id: $stepId})
        CREATE (an:Annotation {
            id: $annoId,
            name: $name,
            score: $score,
            label: $label,
            comment: $comment,
            annotator_kind: 'HUMAN',
            user_id: $userId,
            created_at: $createdAt
        })-[:ANNOTATES]->(s)
        RETURN an
        """,
        {
            "stepId": step_id,
            "annoId": annotation_id,
            "name": annotation.name,
            "score": annotation.score,
            "label": annotation.label,
            "comment": annotation.comment,
            "userId": user_id,
            "createdAt": now,
        },
    )
    if not rows:
        raise HTTPException(
            status_code=500, detail="Failed to create annotation"
        )
    return rows[0]["an"]


# ---------------------------------------------------------------------------
# 8. Execution annotations
# ---------------------------------------------------------------------------


@router.get("/execution/{execution_id}/annotations")
async def get_execution_annotations(
    execution_id: str,
    user: User | None = Depends(current_user),
) -> list[dict[str, Any]]:
    """Get all annotations on an execution."""
    _user_id_from(user)  # auth check
    client = await _get_client_or_503()

    rows = await client.execute_read(
        """
        MATCH (an:Annotation)-[:ANNOTATES]->(e:Execution {id: $id})
        RETURN an
        ORDER BY an.created_at DESC
        """,
        {"id": execution_id},
    )
    return [r["an"] for r in rows]


@router.post("/execution/{execution_id}/annotate")
async def annotate_execution(
    execution_id: str,
    annotation: AnnotationInput,
    user: User | None = Depends(current_user),
) -> dict[str, Any]:
    """Add an annotation to an execution."""
    user_id = _user_id_from(user)
    client = await _get_client_or_503()

    # Verify execution exists
    exec_check = await client.execute_read(
        "MATCH (e:Execution {id: $id}) RETURN e.id AS id",
        {"id": execution_id},
    )
    if not exec_check:
        raise HTTPException(status_code=404, detail="Execution not found")

    annotation_id = str(uuid4())
    now = datetime.utcnow().isoformat()

    rows = await client.execute_write(
        """
        MATCH (e:Execution {id: $execId})
        CREATE (an:Annotation {
            id: $annoId,
            name: $name,
            score: $score,
            label: $label,
            comment: $comment,
            annotator_kind: 'HUMAN',
            user_id: $userId,
            created_at: $createdAt
        })-[:ANNOTATES]->(e)
        RETURN an
        """,
        {
            "execId": execution_id,
            "annoId": annotation_id,
            "name": annotation.name,
            "score": annotation.score,
            "label": annotation.label,
            "comment": annotation.comment,
            "userId": user_id,
            "createdAt": now,
        },
    )
    if not rows:
        raise HTTPException(
            status_code=500, detail="Failed to create annotation"
        )
    return rows[0]["an"]


# ---------------------------------------------------------------------------
# 9. Health check
# ---------------------------------------------------------------------------


@router.get("/health")
async def workflow_health(
    user: User | None = Depends(current_user),
) -> dict[str, Any]:
    """Check Neo4j connectivity."""
    try:
        client = await get_neo4j_client()
        healthy = await client.health_check()
    except Exception:
        healthy = False
    return {"status": "ok" if healthy else "unavailable", "neo4j_connected": healthy}


# ---------------------------------------------------------------------------
# 11. Force sync (admin)
# ---------------------------------------------------------------------------


@router.post("/sync/{session_id}")
async def force_sync(
    session_id: str,
    user: User | None = Depends(current_admin_user),
) -> dict[str, str]:
    """Manually trigger Neo4j sync for a session (admin only)."""
    user_id = _user_id_from(user)

    # Lazy import to avoid circular dependencies
    try:
        from onyx.background.celery.tasks.workflow.tasks import (
            sync_turn_to_neo4j_task,
        )

        sync_turn_to_neo4j_task.apply_async(
            kwargs={
                "session_id": session_id,
                "tenant_id": "",
                "user_id": user_id,
            },
        )
        return {"status": "sync_queued", "session_id": session_id}
    except ImportError:
        logger.warning(
            "Workflow sync task not available; attempting direct sync"
        )
        # Fallback: if the Celery task isn't wired up yet, return a helpful
        # message rather than crashing.
        return {
            "status": "sync_not_available",
            "session_id": session_id,
            "detail": "Workflow sync Celery task is not yet registered",
        }
