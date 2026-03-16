"""Canvas builder helpers for the unified workflow canvas.

Extracts the O(N^2) similarity-based node merging and cross-workflow
edge generation logic out of the API endpoint so it can be tested
and maintained independently.
"""

from typing import Any

import numpy as np

_STEP_SIMILARITY_THRESHOLD = 0.85
_CROSS_WF_THRESHOLD = 0.9


def _cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Return the cosine similarity between two vectors, or 0.0 on degenerate input."""
    norm_a = float(np.linalg.norm(a))
    norm_b = float(np.linalg.norm(b))
    if norm_a < 1e-10 or norm_b < 1e-10:
        return 0.0
    return float(np.dot(a, b)) / (norm_a * norm_b)


def merge_similar_nodes(
    raw_nodes: list[dict[str, Any]],
    node_embeddings: dict[str, list[float]],
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Merge semantically similar nodes *within* the same workflow.

    Returns:
        A tuple of (filtered_nodes, merge_map) where ``merge_map`` maps
        each merged-away node id to the canonical node id it was folded into,
        and ``filtered_nodes`` is the list with merged nodes removed.
    """
    merge_map: dict[str, str] = {}
    wf_groups: dict[str, list[dict[str, Any]]] = {}
    for node in raw_nodes:
        wid = node["data"]["workflow_id"]
        wf_groups.setdefault(wid, []).append(node)

    for _wid, wf_nodes in wf_groups.items():
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
                sim = _cosine_similarity(a1, a2)
                if sim >= _STEP_SIMILARITY_THRESHOLD:
                    merge_map[n2["id"]] = n1["id"]
                    n1["data"]["frequency"] += n2["data"]["frequency"]

    filtered_nodes = [n for n in raw_nodes if n["id"] not in merge_map]
    return filtered_nodes, merge_map


def apply_merge_map_to_edges(
    edges: list[dict[str, Any]],
    merge_map: dict[str, str],
) -> list[dict[str, Any]]:
    """Rewrite edge source/target through *merge_map* and deduplicate."""
    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        if src in merge_map:
            edge["source"] = merge_map[src]
        if tgt in merge_map:
            edge["target"] = merge_map[tgt]

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for edge in edges:
        key = f"{edge['source']}->{edge['target']}"
        if key in seen:
            continue
        seen.add(key)
        deduped.append(edge)
    return deduped


def build_cross_workflow_edges(
    nodes: list[dict[str, Any]],
    node_embeddings: dict[str, list[float]],
    existing_edge_keys: set[str],
) -> list[dict[str, Any]]:
    """Create edges between semantically similar steps in *different* workflows.

    ``existing_edge_keys`` is a set of ``"source_id->target_id"`` strings used
    to avoid duplicating edges that already exist.

    Returns a list of new cross-workflow edge dicts.
    """
    cross_edges: list[dict[str, Any]] = []
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
                continue
            emb2 = node_embeddings.get(nid2)
            if not emb2:
                continue
            a2 = np.array(emb2, dtype=np.float64)
            sim = _cosine_similarity(a1, a2)
            if sim >= _CROSS_WF_THRESHOLD:
                cross_key = f"{nid1}->{nid2}"
                if cross_key not in existing_edge_keys:
                    existing_edge_keys.add(cross_key)
                    cross_edges.append(
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
    return cross_edges
