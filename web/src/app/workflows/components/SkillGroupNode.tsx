"use client";

import { memo } from "react";
import { type NodeProps, type Node } from "@xyflow/react";

interface SkillGroupData extends Record<string, unknown> {
  skillSlug: string;
  skillName: string;
  workflowColor: string;
}

type SkillGroupNodeType = Node<SkillGroupData, "skillGroup">;

function SkillGroupNodeInner({ data }: NodeProps<SkillGroupNodeType>) {
  const color = data.workflowColor || "#a3a3a3";

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `2px dashed ${color}`,
        borderRadius: 12,
        padding: 8,
        position: "relative",
        background: "transparent",
      }}
    >
      {/* Skill label at top-left */}
      <div
        className="bg-white dark:bg-neutral-950"
        style={{
          position: "absolute",
          top: -12,
          left: 16,
          padding: "0 8px",
          fontSize: 11,
          fontWeight: 600,
          color,
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
        {data.skillName || data.skillSlug}
      </div>
    </div>
  );
}

export const SkillGroupNode = memo(SkillGroupNodeInner);
SkillGroupNode.displayName = "SkillGroupNode";
