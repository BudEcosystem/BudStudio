"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

interface WorkflowLabelData extends Record<string, unknown> {
  label: string;
  color: string;
}

type WorkflowLabelNodeType = Node<WorkflowLabelData, "workflowLabel">;

function WorkflowLabelNodeInner({ data }: NodeProps<WorkflowLabelNodeType>) {
  return (
    <div className="px-4 py-2 rounded-lg" style={{ borderLeft: `4px solid ${data.color}` }}>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-0 !h-0 !border-none !bg-transparent"
      />
      <p
        className="text-sm font-bold whitespace-nowrap"
        style={{ color: data.color }}
      >
        {data.label}
      </p>
    </div>
  );
}

export const WorkflowLabelNode = memo(WorkflowLabelNodeInner);
WorkflowLabelNode.displayName = "WorkflowLabelNode";
