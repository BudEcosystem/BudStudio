"use client";

import { Badge } from "@/components/ui/badge";

export interface SubSessionStatusBarProps {
  activeCount: number;
  completedCount: number;
  onViewAll: () => void;
}

/**
 * Compact status bar showing active/completed sub-session counts.
 * Hidden when both counts are 0.
 */
export function SubSessionStatusBar({
  activeCount,
  completedCount,
  onViewAll,
}: SubSessionStatusBarProps) {
  if (activeCount === 0 && completedCount === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border border-border rounded-lg bg-background-tint-01">
      {activeCount > 0 && (
        <Badge variant="in_progress" size="xs">
          {activeCount} active
        </Badge>
      )}
      {completedCount > 0 && (
        <Badge variant="success" size="xs">
          {completedCount} completed
        </Badge>
      )}

      <button
        type="button"
        onClick={onViewAll}
        className="ml-auto text-xs text-text-03 hover:text-text-04 underline underline-offset-2 transition-colors"
      >
        View all
      </button>
    </div>
  );
}
