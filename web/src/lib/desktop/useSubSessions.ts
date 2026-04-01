"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import type {
  SubSessionSummary,
  SubSessionsResponse,
  SpawnSubSessionResponse,
} from "./subSessionTypes";
import type {
  SubSessionSpawnedObj,
  SubSessionProgressObj,
  SubSessionCompleteObj,
  SubSessionFailedObj,
} from "@/app/chat/services/streamingModels";

export interface UseSubSessionsReturn {
  /** All known sub-sessions for the parent. */
  subSessions: SubSessionSummary[];
  /** Number of currently active sub-sessions. */
  activeCount: number;
  /** Number of completed sub-sessions. */
  completedCount: number;
  /** Map from sub_session_id to the agent message ID that spawned it. */
  spawnedByMessage: Map<string, string>;
  /** Handle a sub_session_spawned streaming event. Pass messageId to anchor the sub-session to a specific message. */
  handleSpawned: (data: SubSessionSpawnedObj, messageId?: string) => void;
  /** Handle a sub_session_progress streaming event. */
  handleProgress: (data: SubSessionProgressObj) => void;
  /** Handle a sub_session_complete streaming event. */
  handleComplete: (data: SubSessionCompleteObj) => void;
  /** Handle a sub_session_failed streaming event. */
  handleFailed: (data: SubSessionFailedObj) => void;
  /** Spawn a new sub-session via API. */
  spawnSubSession: (task: string, mode?: string) => Promise<SpawnSubSessionResponse>;
  /** Cancel an active sub-session via API. */
  cancelSubSession: (sessionId: string) => Promise<Record<string, unknown>>;
  /** Re-fetch sub-session list from the API (e.g. after reconnect or tab focus). */
  refetch: () => void;
}

/**
 * Hook for managing sub-sessions of a parent session.
 *
 * Fetches existing sub-sessions on mount and provides handlers for
 * real-time Socket.IO events to keep the list up to date.
 */
export function useSubSessions(
  parentSessionId: string | null
): UseSubSessionsReturn {
  const [subSessions, setSubSessions] = useState<SubSessionSummary[]>([]);
  const [spawnedByMessage, setSpawnedByMessage] = useState<Map<string, string>>(
    () => new Map()
  );

  // Stable fetch function that can be called on demand (reconnect, tab focus, etc.)
  const refetch = useCallback(() => {
    if (!parentSessionId) return;

    (async () => {
      try {
        const res = await fetch(
          `/api/agent/sessions/${parentSessionId}/sub-sessions`
        );
        if (!res.ok) {
          console.error("Failed to fetch sub-sessions:", res.status);
          return;
        }
        const data = (await res.json()) as SubSessionsResponse;
        setSubSessions(data.sub_sessions || []);
      } catch (err) {
        console.error("Error fetching sub-sessions:", err);
      }
    })();
  }, [parentSessionId]);

  // ── Fetch existing sub-sessions on mount / parent change ──
  useEffect(() => {
    if (!parentSessionId) {
      setSubSessions([]);
      return;
    }
    refetch();
  }, [parentSessionId, refetch]);

  // ── Real-time event handlers ──

  const handleSpawned = useCallback((data: SubSessionSpawnedObj, messageId?: string) => {
    const newEntry: SubSessionSummary = {
      session_id: data.sub_session_id,
      parent_session_id: data.parent_session_id,
      task: data.task,
      task_name: data.task_name || data.task,
      status: "ACTIVE",
      session_type: data.mode === "persistent" ? "SUB_PERSISTENT" : "SUB_ONE_SHOT",
      created_at: new Date().toISOString(),
      turns_completed: 0,
      tokens_used: 0,
      tool_calls: 0,
    };
    setSubSessions((prev) => [newEntry, ...prev]);

    // Track which agent message spawned this sub-session
    if (messageId) {
      setSpawnedByMessage((prev) => {
        const next = new Map(prev);
        next.set(data.sub_session_id, messageId);
        return next;
      });
    }
  }, []);

  const handleProgress = useCallback((data: SubSessionProgressObj) => {
    setSubSessions((prev) =>
      prev.map((s) =>
        s.session_id === data.sub_session_id
          ? {
              ...s,
              turns_completed: data.turns_completed,
              tokens_used: data.tokens_used ?? s.tokens_used,
            }
          : s
      )
    );
  }, []);

  const handleComplete = useCallback((data: SubSessionCompleteObj) => {
    setSubSessions((prev) =>
      prev.map((s) =>
        s.session_id === data.sub_session_id
          ? {
              ...s,
              status: "COMPLETED" as const,
              completed_at: new Date().toISOString(),
            }
          : s
      )
    );
  }, []);

  const handleFailed = useCallback((data: SubSessionFailedObj) => {
    setSubSessions((prev) =>
      prev.map((s) =>
        s.session_id === data.sub_session_id
          ? {
              ...s,
              status: "FAILED" as const,
              completed_at: new Date().toISOString(),
            }
          : s
      )
    );
  }, []);

  // ── Computed values ──

  const activeCount = useMemo(
    () => subSessions.filter((s) => s.status === "ACTIVE").length,
    [subSessions]
  );

  const completedCount = useMemo(
    () => subSessions.filter((s) => s.status === "COMPLETED").length,
    [subSessions]
  );

  // ── Actions ──

  const spawnSubSession = useCallback(
    async (
      task: string,
      mode: string = "one_shot"
    ): Promise<SpawnSubSessionResponse> => {
      const res = await fetch(
        `/api/agent/sessions/${parentSessionId}/spin-off`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task, mode }),
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to spawn sub-session: ${res.status}`);
      }
      return res.json() as Promise<SpawnSubSessionResponse>;
    },
    [parentSessionId]
  );

  const cancelSubSession = useCallback(
    async (sessionId: string): Promise<Record<string, unknown>> => {
      const res = await fetch(`/api/agent/sessions/${sessionId}/cancel`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`Failed to cancel sub-session: ${res.status}`);
      }
      return res.json() as Promise<Record<string, unknown>>;
    },
    []
  );

  return {
    subSessions,
    activeCount,
    completedCount,
    spawnedByMessage,
    handleSpawned,
    handleProgress,
    handleComplete,
    handleFailed,
    spawnSubSession,
    cancelSubSession,
    refetch,
  };
}
