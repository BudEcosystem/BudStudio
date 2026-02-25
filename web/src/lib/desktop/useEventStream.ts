"use client";

import { useEffect, useRef, useCallback, useState } from "react";

/**
 * A single event from the SSE stream.
 */
export interface EventStreamEvent {
  event: string;
  data: Record<string, unknown>;
  ts: string;
}

interface UseEventStreamOptions {
  enabled: boolean;
  onEvent: (event: EventStreamEvent) => void;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Opens a persistent SSE connection to `/api/agent/events/stream`
 * and dispatches parsed events to the caller.
 *
 * Reconnects with exponential backoff on disconnect.
 */
export function useEventStream({
  enabled,
  onEvent,
}: UseEventStreamOptions): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const backoffRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stable ref for the callback to avoid reconnection on callback change
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const connect = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const response = await fetch("/api/agent/events/stream", {
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new Error(`SSE connect failed: ${response.status}`);
        }

        setConnected(true);
        backoffRef.current = 1000; // Reset backoff on successful connect

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();

            // Skip empty lines and SSE comments (keepalives)
            if (!trimmed || trimmed.startsWith(":")) continue;

            // Strip SSE data: prefix
            let jsonStr = trimmed;
            if (trimmed.startsWith("data: ")) {
              jsonStr = trimmed.slice(6);
            }

            try {
              const event = JSON.parse(jsonStr) as EventStreamEvent;
              onEventRef.current(event);
            } catch {
              // Ignore unparseable lines
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        console.warn("Event stream disconnected:", err);
      } finally {
        setConnected(false);
        abortRef.current = null;

        // Schedule reconnect with exponential backoff
        if (enabled) {
          const delay = backoffRef.current;
          backoffRef.current = Math.min(delay * 2, MAX_BACKOFF_MS);
          reconnectTimerRef.current = setTimeout(connect, delay);
        }
      }
    })();
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnected(false);
      return;
    }

    connect();

    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [enabled, connect]);

  return { connected };
}
