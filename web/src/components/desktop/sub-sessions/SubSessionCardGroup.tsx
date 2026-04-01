"use client";

import { SubSessionCard } from "./SubSessionCard";
import type { SubSessionSummary } from "@/lib/desktop/subSessionTypes";

export interface SubSessionCardGroupProps {
  subSessions: SubSessionSummary[];
  onCardClick: (sessionId: string) => void;
}

/**
 * Vertical stack of SubSessionCard components.
 */
export function SubSessionCardGroup({
  subSessions,
  onCardClick,
}: SubSessionCardGroupProps) {
  if (subSessions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {subSessions.map((session) => (
        <SubSessionCard
          key={session.session_id}
          session={session}
          onClick={onCardClick}
        />
      ))}
    </div>
  );
}
