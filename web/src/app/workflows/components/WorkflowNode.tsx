"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  Clock,
  Cpu,
  ArrowUpFromLine,
  User,
  Bot,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkflowNodeData } from "@/lib/workflow/types";

type WorkflowStepNode = Node<WorkflowNodeData, "workflowStep">;

function NodeTypeIcon({ nodeType, inputSource }: { nodeType?: string; inputSource?: string | null }) {
  switch (nodeType) {
    case "input":
      return inputSource === "human" ? (
        <User className="h-4 w-4 text-blue-500 dark:text-blue-400 shrink-0" />
      ) : (
        <Bot className="h-4 w-4 text-cyan-500 dark:text-cyan-400 shrink-0" />
      );
    case "output":
      return <ArrowUpFromLine className="h-4 w-4 text-green-500 dark:text-green-400 shrink-0" />;
    case "compute":
    default:
      return <Cpu className="h-4 w-4 text-orange-500 dark:text-orange-400 shrink-0" />;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function WorkflowNodeInner({ data, selected }: NodeProps<WorkflowStepNode>) {
  const { step, workflowColor, nodeType, inputSource } = data;

  const borderStyle = workflowColor
    ? { borderLeftWidth: 4, borderLeftColor: workflowColor }
    : undefined;

  return (
    <div
      className={cn(
        "w-[240px] rounded-lg border bg-white dark:bg-neutral-900 px-3 py-2.5 shadow-sm transition-all",
        "hover:shadow-md",
        selected
          ? "border-blue-500 shadow-blue-100 dark:shadow-blue-900/30 ring-1 ring-blue-500"
          : "border-neutral-200 dark:border-neutral-700",
      )}
      style={borderStyle}
    >
      {/* Handles */}
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-neutral-400 dark:!bg-neutral-500 !border-none"
      />
      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-neutral-400 dark:!bg-neutral-500 !border-none"
      />

      {/* Node type badge */}
      {nodeType && (
        <div className="flex items-center justify-end mb-1">
          <span
            className={cn(
              "text-[9px] font-medium px-1.5 py-0.5 rounded-full uppercase tracking-wider",
              nodeType === "input" && "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
              nodeType === "compute" && "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
              nodeType === "output" && "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
            )}
          >
            {nodeType}
            {nodeType === "input" && inputSource && (
              <span className="ml-0.5 opacity-75">
                {inputSource === "human" ? " (user)" : " (agent)"}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Content: icon + name + description */}
      <div className="flex items-start gap-2">
        <NodeTypeIcon nodeType={nodeType} inputSource={inputSource} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 leading-tight">
            {step.name}
          </p>
          {step.description && (
            <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2 leading-snug">
              {step.description}
            </p>
          )}
          {step.duration_ms > 0 && (
            <div className="flex items-center gap-1.5 mt-1">
              <Clock className="h-3 w-3 text-neutral-400 dark:text-neutral-500 shrink-0" />
              <span className="text-xs text-neutral-500 dark:text-neutral-400">
                {formatDuration(step.duration_ms)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeInner);
WorkflowNode.displayName = "WorkflowNode";
