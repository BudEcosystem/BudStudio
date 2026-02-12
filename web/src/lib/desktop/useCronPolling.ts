"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  CronNotification,
  CronToolRequest,
  PendingCronData,
} from "@/lib/agent/types";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const PAGE_SIZE = 50;

interface UseCronPollingResult {
  notifications: CronNotification[];
  toolRequests: CronToolRequest[];
  unreadCount: number;
  dismissNotification: (executionId: string) => Promise<void>;
  dismissAllNotifications: () => Promise<void>;
  loadMoreNotifications: () => Promise<void>;
  hasMore: boolean;
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
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const loadingMoreRef = useRef(false);

  const fetchPending = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/agent/cron/pending?offset=0&limit=${PAGE_SIZE}`
      );
      if (!response.ok) return;

      const data: PendingCronData = await response.json();
      setNotifications(data.notifications);
      setToolRequests(data.tool_requests);
      setHasMore(data.has_more_notifications);
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

  const dismissAllNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/cron/acknowledge-all", {
        method: "POST",
      });
      if (response.ok) {
        setNotifications([]);
        setHasMore(false);
      }
    } catch {
      // Ignore
    }
  }, []);

  const loadMoreNotifications = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    try {
      const offset = notifications.length;
      const response = await fetch(
        `/api/agent/cron/pending?offset=${offset}&limit=${PAGE_SIZE}`
      );
      if (!response.ok) return;

      const data: PendingCronData = await response.json();
      setNotifications((prev) => [...prev, ...data.notifications]);
      setHasMore(data.has_more_notifications);
    } catch {
      // Ignore
    } finally {
      loadingMoreRef.current = false;
    }
  }, [hasMore, notifications.length]);

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
    dismissAllNotifications,
    loadMoreNotifications,
    hasMore,
    submitToolResult,
    isLoading,
  };
}
