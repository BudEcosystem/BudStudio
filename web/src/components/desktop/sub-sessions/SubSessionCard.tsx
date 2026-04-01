"use client";

import { cn } from "@/lib/utils";
import { FiCheck, FiX } from "react-icons/fi";
import type { SubSessionSummary } from "@/lib/desktop/subSessionTypes";

export interface SubSessionCardProps {
  session: SubSessionSummary;
  onClick: (sessionId: string) => void;
}

/**
 * Status icon for a sub-session: spinner (ACTIVE), checkmark (COMPLETED), X (FAILED).
 */
function StatusIcon({ status }: { status: SubSessionSummary["status"] }) {
  switch (status) {
    case "ACTIVE":
      return (
        <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      );
    case "COMPLETED":
      return <FiCheck className="w-4 h-4 text-green-500 flex-shrink-0" />;
    case "FAILED":
      return <FiX className="w-4 h-4 text-red-500 flex-shrink-0" />;
  }
}

/**
 * Compact card displaying a sub-session summary with status, task, and progress.
 */
export function SubSessionCard({ session, onClick }: SubSessionCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(session.session_id)}
      className={cn(
        "w-full text-left rounded-lg border border-border px-3 py-2",
        "bg-background hover:bg-background-tint-02 transition-colors",
        "flex items-center gap-2 cursor-pointer"
      )}
    >
      <StatusIcon status={session.status} />

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-04 truncate">
          {session.task}
        </p>
        <p className="text-xs text-text-02 mt-0.5">
          {session.turns_completed} turn{session.turns_completed !== 1 ? "s" : ""}
          {session.tokens_used > 0 && (
            <span className="ml-2">
              {session.tokens_used.toLocaleString()} tokens
            </span>
          )}
        </p>
      </div>
    </button>
  );
}
