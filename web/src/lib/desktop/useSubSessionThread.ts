"use client";

import { useState, useCallback } from "react";
import type {
  SubSessionSummary,
  ThreadMessage,
  SubSessionThreadResponse,
} from "./subSessionTypes";

export interface UseSubSessionThreadReturn {
  /** Messages in the currently-open sub-session thread. */
  messages: ThreadMessage[];
  /** Whether thread data is being fetched. */
  isLoading: boolean;
  /** The sub-session whose thread is open, or null if none. */
  session: SubSessionSummary | null;
  /** Open a sub-session thread by fetching its history. */
  openThread: (sessionId: string) => Promise<void>;
  /** Close the currently-open thread and clear state. */
  closeThread: () => void;
  /** Send a follow-up message to the open sub-session. */
  sendFollowUp: (message: string) => Promise<Record<string, unknown> | undefined>;
  /** Cancel the open sub-session. */
  cancel: () => Promise<Record<string, unknown> | undefined>;
}

/**
 * Hook for viewing and interacting with a single sub-session's thread.
 *
 * Provides message history, loading state, and actions (follow-up, cancel).
 */
export function useSubSessionThread(): UseSubSessionThreadReturn {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [session, setSession] = useState<SubSessionSummary | null>(null);

  const openThread = useCallback(async (sessionId: string): Promise<void> => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/agent/sessions/${sessionId}/thread`);
      if (!res.ok) {
        console.error("Failed to fetch sub-session thread:", res.status);
        return;
      }
      const data = (await res.json()) as SubSessionThreadResponse;
      setMessages(data.messages || []);
      setSession(data.session || null);
    } catch (err) {
      console.error("Error fetching sub-session thread:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const closeThread = useCallback(() => {
    setMessages([]);
    setSession(null);
  }, []);

  const sendFollowUp = useCallback(
    async (
      message: string
    ): Promise<Record<string, unknown> | undefined> => {
      if (!session) return undefined;
      try {
        const res = await fetch(
          `/api/agent/sessions/${session.session_id}/followup`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message }),
          }
        );
        if (!res.ok) {
          throw new Error(`Failed to send follow-up: ${res.status}`);
        }
        return (await res.json()) as Record<string, unknown>;
      } catch (err) {
        console.error("Error sending follow-up:", err);
        return undefined;
      }
    },
    [session]
  );

  const cancel = useCallback(async (): Promise<
    Record<string, unknown> | undefined
  > => {
    if (!session) return undefined;
    try {
      const res = await fetch(
        `/api/agent/sessions/${session.session_id}/cancel`,
        {
          method: "POST",
        }
      );
      if (!res.ok) {
        throw new Error(`Failed to cancel sub-session: ${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    } catch (err) {
      console.error("Error cancelling sub-session:", err);
      return undefined;
    }
  }, [session]);

  return {
    messages,
    isLoading,
    session,
    openThread,
    closeThread,
    sendFollowUp,
    cancel,
  };
}
