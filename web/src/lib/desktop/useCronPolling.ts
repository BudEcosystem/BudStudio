"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  CronNotification,
  CronToolRequest,
  PendingCronData,
} from "@/lib/agent/types";

const POLL_INTERVAL_MS = 30_000; // 30 seconds

interface UseCronPollingResult {
  notifications: CronNotification[];
  toolRequests: CronToolRequest[];
  unreadCount: number;
  dismissNotification: (executionId: string) => Promise<void>;
  submitToolResult: (
    executionId: string,
    output?: string,
    error?: string
  ) => Promise<void>;
  isLoading: boolean;
}

export function useCronPolling(enabled: boolean = true): UseCronPollingResult {
  const [notifications, setNotifications] = useState<CronNotification[]>([]);
  const [toolRequests, setToolRequests] = useState<CronToolRequest[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchPending = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/cron/pending");
      if (!response.ok) return;

      const data: PendingCronData = await response.json();
      setNotifications(data.notifications);
      setToolRequests(data.tool_requests);
    } catch {
      // Silently ignore polling failures
    }
  }, []);

  const dismissNotification = useCallback(
    async (executionId: string) => {
      try {
        const response = await fetch(
          `/api/agent/cron/executions/${executionId}/acknowledge`,
          { method: "POST" }
        );
        if (response.ok) {
          setNotifications((prev) =>
            prev.filter((n) => n.id !== executionId)
          );
        }
      } catch {
        // Ignore
      }
    },
    []
  );

  const submitToolResult = useCallback(
    async (executionId: string, output?: string, error?: string) => {
      try {
        setIsLoading(true);
        const response = await fetch(
          `/api/agent/cron/executions/${executionId}/tool-result`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ output: output ?? null, error: error ?? null }),
          }
        );
        if (response.ok) {
          // Remove from tool requests
          setToolRequests((prev) =>
            prev.filter((t) => t.id !== executionId)
          );
        }
      } catch {
        // Ignore
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Start/stop polling
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Initial fetch
    fetchPending();

    // Set up polling interval
    intervalRef.current = setInterval(fetchPending, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, fetchPending]);

  return {
    notifications,
    toolRequests,
    unreadCount: notifications.length,
    dismissNotification,
    submitToolResult,
    isLoading,
  };
}
