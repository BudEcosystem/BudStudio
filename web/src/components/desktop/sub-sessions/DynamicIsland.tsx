"use client";

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import { cn } from "@/lib/utils";
import { FiCheck, FiX, FiMinus, FiChevronUp } from "react-icons/fi";
import SvgBubbleText from "@/icons/bubble-text";
import { FiPause } from "react-icons/fi";
import type {
  SubSessionSummary,
  SubSessionStatus,
  SubSessionExecutionStatus,
} from "@/lib/desktop/subSessionTypes";

/* ─── Props ─── */

export interface DynamicIslandProps {
  subSessions: SubSessionSummary[];
  activeCount: number;
  completedCount: number;
  onSelectSession: (sessionId: string) => void;
  onCancelSession: (sessionId: string) => void;
}

/* ─── Helpers ─── */

function StatusIcon({
  status,
  executionStatus,
  size = "sm",
}: {
  status: SubSessionStatus;
  executionStatus?: SubSessionExecutionStatus;
  size?: "sm" | "md";
}) {
  const dim = size === "md" ? "w-4 h-4" : "w-3.5 h-3.5";

  // For ACTIVE sessions, use execution_status to distinguish running vs idle
  if (status === "ACTIVE") {
    const isRunning = executionStatus === "RUNNING" || executionStatus === "AWAITING_TOOL";
    if (isRunning) {
      return (
        <div
          className={cn(
            dim,
            "border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"
          )}
        />
      );
    }
    // ACTIVE but IDLE — waiting for input
    return <FiPause className={cn(dim, "text-amber-500 flex-shrink-0")} />;
  }

  switch (status) {
    case "COMPLETED":
      return <FiCheck className={cn(dim, "text-green-500 flex-shrink-0")} />;
    case "FAILED":
      return <FiX className={cn(dim, "text-red-500 flex-shrink-0")} />;
    case "INACTIVE":
      return <FiMinus className={cn(dim, "text-text-02 flex-shrink-0")} />;
  }
}

function useTimeAgo(isoTimestamp: string): string {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000); // update every 30s
    return () => clearInterval(id);
  }, []);

  const diffSec = Math.max(
    0,
    Math.floor((now - new Date(isoTimestamp).getTime()) / 1000)
  );

  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/* ─── Task Row (expanded view) ─── */

function DynamicIslandTaskRow({
  session,
  onSelect,
  onCancel,
}: {
  session: SubSessionSummary;
  onSelect: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const lastUpdate = useTimeAgo(session.updated_at || session.created_at);

  return (
    <div data-testid={`dynamic-island-task-${session.session_id}`} className="flex items-center gap-2 px-4 py-2.5 hover:bg-background-tint-02 transition-colors">
      <StatusIcon status={session.status} executionStatus={session.execution_status} size="md" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onSelect(session.session_id)}
      >
        <p className="text-sm text-text-04 truncate">{session.task_name}</p>
        <p className="text-xs text-text-02">
          last update {lastUpdate}
        </p>
      </button>
      {session.status === "ACTIVE" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCancel(session.session_id);
          }}
          className="text-xs text-text-02 hover:text-red-500 transition-colors px-1.5 py-0.5 rounded hover:bg-red-500/10"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

/* ─── Main Component ─── */

export function DynamicIsland({
  subSessions,
  activeCount,
  completedCount,
  onSelectSession,
  onCancelSession,
}: DynamicIslandProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showExpandedContent, setShowExpandedContent] = useState(false);
  const [rotationIndex, setRotationIndex] = useState(0);
  const [flashStatus, setFlashStatus] = useState<
    "completed" | "failed" | null
  >(null);
  const [flashKey, setFlashKey] = useState(0);
  const [fadeLabel, setFadeLabel] = useState(true);
  const [isIdle, setIsIdle] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const prevSessionsRef = useRef<SubSessionSummary[]>([]);
  const prevRotationRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── Derived ── */

  const activeTasks = useMemo(
    () => subSessions.filter((s) => s.status === "ACTIVE"),
    [subSessions]
  );

  const runningTasks = useMemo(
    () => activeTasks.filter((s) =>
      s.execution_status === "RUNNING" || s.execution_status === "AWAITING_TOOL"
    ),
    [activeTasks]
  );

  const currentTask = useMemo(() => {
    // Prioritize truly running tasks for the pill display
    if (runningTasks.length > 0) {
      return runningTasks[rotationIndex % runningTasks.length];
    }
    if (activeTasks.length > 0) {
      return activeTasks[rotationIndex % activeTasks.length];
    }
    // Show most recent non-active session
    const sorted = [...subSessions].sort(
      (a, b) =>
        new Date(b.completed_at ?? b.created_at).getTime() -
        new Date(a.completed_at ?? a.created_at).getTime()
    );
    return sorted[0] ?? null;
  }, [activeTasks, runningTasks, rotationIndex, subSessions]);

  const othersCount = subSessions.length - 1;

  /* ── Task rotation (compact mode) ── */

  useEffect(() => {
    if (isExpanded || runningTasks.length <= 1) return;
    const id = setInterval(() => {
      setRotationIndex((prev) => prev + 1);
    }, 4000);
    return () => clearInterval(id);
  }, [isExpanded, runningTasks.length]);

  // Reset rotation index when running tasks change
  useEffect(() => {
    setRotationIndex(0);
  }, [runningTasks.length]);

  // Crossfade on rotation change
  useEffect(() => {
    if (prevRotationRef.current !== rotationIndex) {
      setFadeLabel(false);
      const timer = setTimeout(() => setFadeLabel(true), 150);
      prevRotationRef.current = rotationIndex;
      return () => clearTimeout(timer);
    }
  }, [rotationIndex]);

  /* ── Flash detection ── */

  useEffect(() => {
    const prev = prevSessionsRef.current;
    if (prev.length === 0) {
      prevSessionsRef.current = subSessions;
      return;
    }

    for (const session of subSessions) {
      const prevSession = prev.find(
        (p) => p.session_id === session.session_id
      );
      if (!prevSession) continue;

      if (
        prevSession.status === "ACTIVE" &&
        session.status === "COMPLETED"
      ) {
        setFlashStatus("completed");
        setFlashKey((k) => k + 1);
        break;
      }
      if (
        prevSession.status === "ACTIVE" &&
        session.status === "FAILED"
      ) {
        setFlashStatus("failed");
        setFlashKey((k) => k + 1);
        break;
      }
    }

    prevSessionsRef.current = subSessions;
  }, [subSessions]);

  // Clear flash after animation
  useEffect(() => {
    if (!flashStatus) return;
    const timer = setTimeout(() => setFlashStatus(null), 850);
    return () => clearTimeout(timer);
  }, [flashStatus, flashKey]);

  /* ── Idle state (5s after last event, no active tasks) ── */

  // Reset idle timer on any sub-session change
  useEffect(() => {
    setIsIdle(false);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setIsIdle(true);
    }, 5000);
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [subSessions]);

  // If there are running tasks, never go idle
  useEffect(() => {
    if (runningTasks.length > 0) setIsIdle(false);
  }, [runningTasks.length]);

  /* ── Expand / Collapse ── */

  const expand = useCallback(() => {
    setIsExpanded(true);
    setTimeout(() => setShowExpandedContent(true), 150);
  }, []);

  const collapse = useCallback(() => {
    setShowExpandedContent(false);
    setTimeout(() => setIsExpanded(false), 300);
  }, []);

  const toggleExpanded = useCallback(() => {
    if (isExpanded) collapse();
    else expand();
  }, [isExpanded, collapse, expand]);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      collapse();
      onSelectSession(sessionId);
    },
    [collapse, onSelectSession]
  );

  /* ── Click outside ── */

  useEffect(() => {
    if (!isExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        collapse();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isExpanded, collapse]);

  /* ── Escape key ── */

  useEffect(() => {
    if (!isExpanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") collapse();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isExpanded, collapse]);

  /* ── Render gate ── */

  if (subSessions.length === 0 || !currentTask) return null;

  /* ── Computed max-height for expanded ── */

  const expandedMaxHeight = Math.min(
    400,
    subSessions.length * 56 + 52 // row height ~56px + header ~52px
  );

  return (
    <div data-testid="dynamic-island" className="absolute -top-[2px] left-1/2 -translate-x-1/2 z-[35]">
      <div
        key={flashKey}
        ref={containerRef}
        onClick={!isExpanded ? toggleExpanded : undefined}
        className={cn(
          // Base — same bg as sidebar, no border, no blur
          "bg-background-tint-01 shadow-lg overflow-hidden",
          "transition-[width,max-height,border-radius,box-shadow] duration-300 ease-in-out",
          // Bottom-only border radius
          "rounded-t-none rounded-b-[20px]",
          // Appear animation
          "animate-fade-in-scale",
          // Flash
          flashStatus === "completed" && "animate-flash-success",
          flashStatus === "failed" && "animate-flash-error",
          // Morphing
          isExpanded
            ? "w-[380px]"
            : "w-[280px] cursor-pointer hover:shadow-blue-500/5"
        )}
        style={{
          maxHeight: isExpanded ? `${expandedMaxHeight}px` : "44px",
        }}
      >
        {/* ── Compact Pill ── */}
        <div
          className={cn(
            "flex items-center gap-2.5 px-4 h-[44px]",
            "transition-opacity duration-200",
            isExpanded
              ? "opacity-0 pointer-events-none absolute inset-x-0"
              : "opacity-100"
          )}
        >
          {isIdle && runningTasks.length === 0 ? (
            /* Idle summary: thread icon + count */
            <div className="flex items-center gap-2 flex-1 transition-opacity duration-300">
              <SvgBubbleText className="w-4 h-4 stroke-current text-text-02 flex-shrink-0" />
              <span className="text-sm text-text-04">
                {runningTasks.length > 0
                  ? `${runningTasks.length} running thread${runningTasks.length !== 1 ? "s" : ""}`
                  : `${subSessions.length} thread${subSessions.length !== 1 ? "s" : ""}`}
              </span>
            </div>
          ) : (
            /* Running: show current task name + badge */
            <>
              <StatusIcon status={currentTask.status} executionStatus={currentTask.execution_status} size="md" />
              <span
                className={cn(
                  "text-sm text-text-04 truncate flex-1 transition-opacity duration-150",
                  fadeLabel ? "opacity-100" : "opacity-0"
                )}
              >
                {currentTask.task_name}
              </span>
              {othersCount > 0 && (
                <span className="text-[11px] font-medium text-text-02 bg-background-tint-02 rounded-full px-1.5 py-0.5 flex-shrink-0">
                  +{othersCount}
                </span>
              )}
            </>
          )}
        </div>

        {/* ── Expanded Card ── */}
        {isExpanded && (
          <div
            className={cn(
              "transition-opacity duration-200",
              showExpandedContent ? "opacity-100" : "opacity-0"
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text-04">
                  Background Threads
                </span>
                <span className="text-xs text-text-02">
                  {runningTasks.length > 0 && (
                    <span className="text-blue-500">
                      {runningTasks.length} running
                    </span>
                  )}
                  {runningTasks.length > 0 && completedCount > 0 && " · "}
                  {completedCount > 0 && (
                    <span className="text-green-500">
                      {completedCount} done
                    </span>
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={collapse}
                className="p-1 rounded-md hover:bg-background-tint-02 transition-colors text-text-02 hover:text-text-04"
              >
                <FiChevronUp className="w-4 h-4" />
              </button>
            </div>

            {/* Task list */}
            <div className="max-h-[320px] overflow-y-auto default-scrollbar py-1">
              {subSessions.map((session) => (
                <DynamicIslandTaskRow
                  key={session.session_id}
                  session={session}
                  onSelect={handleSelectSession}
                  onCancel={onCancelSession}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
