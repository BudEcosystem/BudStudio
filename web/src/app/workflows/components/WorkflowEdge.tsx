"use client";

import { memo } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
  type Edge,
  MarkerType,
} from "@xyflow/react";

interface WorkflowEdgeData extends Record<string, unknown> {
  frequency?: number;
  isGoldenPath?: boolean;
  workflowColor?: string;
  label?: string;
}

type WorkflowEdgeType = Edge<WorkflowEdgeData, "workflowEdge">;

function WorkflowEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps<WorkflowEdgeType>) {
  const isGoldenPath = data?.isGoldenPath ?? false;
  const frequency = data?.frequency ?? 0;
  const workflowColor = data?.workflowColor;
  const label = data?.label;

  // Vary stroke width based on frequency (1 to 4px)
  const strokeWidth = 1 + Math.min(frequency / 3, 3);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const strokeColor = selected
    ? "#3b82f6"
    : workflowColor
      ? workflowColor
      : isGoldenPath
        ? "#60a5fa"
        : "#a3a3a3";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: strokeColor,
          strokeWidth,
          transition: "stroke 0.2s, stroke-width 0.2s",
        }}
      />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-sm whitespace-nowrap"
          >
            <span style={{ color: workflowColor ?? "#737373" }}>{label}</span>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const WorkflowEdge = memo(WorkflowEdgeInner);
WorkflowEdge.displayName = "WorkflowEdge";

/**
 * Default edge options applied to all workflow edges.
 * Use with ReactFlow's `defaultEdgeOptions` prop.
 */
export const defaultWorkflowEdgeOptions = {
  type: "workflowEdge" as const,
  animated: false,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 16,
    height: 16,
    color: "#a3a3a3",
  },
};
