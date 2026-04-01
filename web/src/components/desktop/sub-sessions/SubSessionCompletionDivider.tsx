"use client";

import { cn } from "@/lib/utils";
import { FiCheck, FiX } from "react-icons/fi";

export interface SubSessionCompletionDividerProps {
  task: string;
  status: "COMPLETED" | "FAILED";
}

/**
 * Inline divider rendered in the message list when a sub-session finishes.
 * Shows a horizontal rule with a centered status label:
 *   -- [check] {task} completed --
 *   -- [x] {task} failed --
 */
export function SubSessionCompletionDivider({
  task,
  status,
}: SubSessionCompletionDividerProps) {
  const isCompleted = status === "COMPLETED";

  return (
    <div className="flex items-center gap-3 py-2 select-none">
      <div className="flex-1 h-px bg-border" />
      <div
        className={cn(
          "flex items-center gap-1.5 text-xs font-medium",
          isCompleted
            ? "text-green-600 dark:text-green-400"
            : "text-red-600 dark:text-red-400"
        )}
      >
        {isCompleted ? (
          <FiCheck className="w-3.5 h-3.5" />
        ) : (
          <FiX className="w-3.5 h-3.5" />
        )}
        <span className="truncate max-w-[200px]">{task}</span>
        <span>{isCompleted ? "completed" : "failed"}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
