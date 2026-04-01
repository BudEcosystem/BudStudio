"use client";

import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { FiCheck, FiX } from "react-icons/fi";
import type { SubSessionSummary, SubSessionStatus } from "@/lib/desktop/subSessionTypes";

export interface SubSessionListDropdownProps {
  subSessions: SubSessionSummary[];
  isOpen: boolean;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
}

function StatusIcon({ status }: { status: SubSessionStatus }) {
  switch (status) {
    case "ACTIVE":
      return (
        <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
      );
    case "COMPLETED":
      return <FiCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />;
    case "FAILED":
      return <FiX className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />;
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

/**
 * Dropdown listing all sub-sessions with status, task, and timestamps.
 * Scrollable up to max-h-96. Closes on outside click.
 */
export function SubSessionListDropdown({
  subSessions,
  isOpen,
  onClose,
  onSelect,
}: SubSessionListDropdownProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  const handleClickOutside = useCallback(
    (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen, handleClickOutside]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute z-50 mt-1 w-80 max-h-96 overflow-y-auto",
        "rounded-lg border border-border bg-background shadow-lg"
      )}
    >
      {subSessions.length === 0 ? (
        <div className="px-4 py-3 text-sm text-text-02">
          No sub-sessions yet
        </div>
      ) : (
        <ul className="py-1">
          {subSessions.map((session) => (
            <li key={session.session_id}>
              <button
                type="button"
                onClick={() => onSelect(session.session_id)}
                className={cn(
                  "w-full text-left px-4 py-2.5 flex items-start gap-2",
                  "hover:bg-background-tint-02 transition-colors"
                )}
              >
                <div className="mt-0.5">
                  <StatusIcon status={session.status} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-text-04 truncate">{session.task}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-text-02">
                      {formatTimestamp(session.created_at)}
                    </span>
                    {session.completed_at && (
                      <span className="text-xs text-text-02">
                        - {formatTimestamp(session.completed_at)}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
