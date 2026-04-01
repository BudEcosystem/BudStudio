"use client";

import { cn } from "@/lib/utils";
import { FiCheck, FiX } from "react-icons/fi";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SubSessionSummary } from "@/lib/desktop/subSessionTypes";

export interface SubSessionChipProps {
  session: SubSessionSummary;
  onClick: (sessionId: string) => void;
}

function ChipStatusIcon({ status }: { status: SubSessionSummary["status"] }) {
  switch (status) {
    case "ACTIVE":
      return (
        <div className="w-3 h-3 border-[1.5px] border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      );
    case "COMPLETED":
      return <FiCheck className="w-3 h-3 text-green-600 flex-shrink-0" />;
    case "FAILED":
      return <FiX className="w-3 h-3 text-red-500 flex-shrink-0" />;
  }
}

/**
 * Compact inline chip for a sub-session, styled similar to citations.
 * Shows a small status icon + task_name, clickable to open thread panel.
 */
export function SubSessionChip({ session, onClick }: SubSessionChipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onClick(session.session_id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md",
              "bg-background-tint-03 hover:bg-background-tint-04",
              "border border-border/50 shadow-sm",
              "cursor-pointer transition-all duration-150",
              "text-xs font-medium text-text-04",
              "align-middle mx-0.5"
            )}
          >
            <ChipStatusIcon status={session.status} />
            <span className="truncate max-w-[160px]">
              {session.task_name}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent
          className="!p-2 border-border-01 border rounded-12 bg-background-neutral-00 shadow-02 max-w-xs"
          side="bottom"
          align="start"
        >
          <p className="text-xs font-medium text-text-04 mb-1">
            {session.task_name}
          </p>
          <p className="text-xs text-text-02 line-clamp-2">
            {session.task}
          </p>
          <p className="text-xs text-text-02 mt-1">
            {session.status === "ACTIVE" ? "Running" : session.status.toLowerCase()}
            {session.turns_completed > 0 && (
              <span>
                {" \u00B7 "}
                {session.turns_completed} turn{session.turns_completed !== 1 ? "s" : ""}
              </span>
            )}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface SubSessionChipGroupProps {
  subSessions: SubSessionSummary[];
  onChipClick: (sessionId: string) => void;
}

/**
 * Inline row of SubSessionChip components, wrapping as needed.
 */
export function SubSessionChipGroup({
  subSessions,
  onChipClick,
}: SubSessionChipGroupProps) {
  if (subSessions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      {subSessions.map((session) => (
        <SubSessionChip
          key={session.session_id}
          session={session}
          onClick={onChipClick}
        />
      ))}
    </div>
  );
}
