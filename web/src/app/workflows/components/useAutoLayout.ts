"use client";

import dagre from "@dagrejs/dagre";
import { type Node, type Edge } from "@xyflow/react";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 90;
const LABEL_WIDTH = 180;
const LABEL_HEIGHT = 40;

/**
 * Pure function: compute dagre layout positions for React Flow nodes.
 * Returns a new array of nodes with updated positions.
 */
export function computeLayout(
  nodes: Node[],
  edges: Edge[],
  direction: "LR" | "TB" = "LR"
): Node[] {
  if (nodes.length === 0) return nodes;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 80,
    ranksep: 150,
  });

  nodes.forEach((node) => {
    const isLabel = node.type === "workflowLabel";
    g.setNode(node.id, {
      width: isLabel ? LABEL_WIDTH : NODE_WIDTH,
      height: isLabel ? LABEL_HEIGHT : NODE_HEIGHT,
    });
  });

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target);
  });

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    if (!pos) return node;
    const isLabel = node.type === "workflowLabel";
    const w = isLabel ? LABEL_WIDTH : NODE_WIDTH;
    const h = isLabel ? LABEL_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });
}
