"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  ConversationListItem,
  ConversationDetail,
  InboxMessageSnapshot,
  InboxSettings,
} from "@/lib/agent/types";

const POLL_INTERVAL_MS = 30_000; // 30 seconds
const SLOW_POLL_INTERVAL_MS = 120_000; // 120 seconds (when SSE is connected)

interface UseInboxPollingResult {
  unreadCount: number;
  conversations: ConversationListItem[];
  conversationDetail: ConversationDetail | null;
  settings: InboxSettings;
  isLoading: boolean;
  fetchUnreadCount: () => Promise<void>;
  fetchConversations: () => Promise<void>;
  fetchConversationDetail: (conversationId: string) => Promise<void>;
  markRead: (conversationId: string) => Promise<void>;
  sendReply: (conversationId: string, text: string) => Promise<InboxMessageSnapshot | null>;
  sendNewMessage: (recipient: string, text: string, goal: string) => Promise<InboxMessageSnapshot | null>;
  completeGoal: (conversationId: string) => Promise<boolean>;
  cancelGoal: (conversationId: string) => Promise<boolean>;
  fetchSettings: () => Promise<void>;
  updateSettings: (settings: InboxSettings) => Promise<void>;
}

export function useInboxPolling(
  enabled: boolean = true,
  slowMode: boolean = false,
): UseInboxPollingResult {
  const [unreadCount, setUnreadCount] = useState(0);
  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [conversationDetail, setConversationDetail] = useState<ConversationDetail | null>(null);
  const [settings, setSettings] = useState<InboxSettings>({
    auto_reply_enabled: true,
    reply_depth_limit: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/inbox/unread-count");
      if (!response.ok) return;
      const data = await response.json();
      setUnreadCount(data.unread_count ?? 0);
    } catch {
      // Silently ignore polling failures
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch("/api/agent/inbox/conversations");
      if (!response.ok) return;
      const data: ConversationListItem[] = await response.json();
      setConversations(data);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchConversationDetail = useCallback(async (conversationId: string) => {
    try {
      setIsLoading(true);
      const response = await fetch(`/api/agent/inbox/conversations/${conversationId}`);
      if (!response.ok) return;
      const data: ConversationDetail = await response.json();
      setConversationDetail(data);
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  const markRead = useCallback(async (conversationId: string) => {
    try {
      const response = await fetch(
        `/api/agent/inbox/conversations/${conversationId}/read`,
        { method: "POST" }
      );
      if (response.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.conversation_id === conversationId
              ? { ...c, unread_count: 0 }
              : c
          )
        );
        await fetchUnreadCount();
      }
    } catch {
      // Ignore
    }
  }, [fetchUnreadCount]);

  const sendReply = useCallback(
    async (conversationId: string, text: string): Promise<InboxMessageSnapshot | null> => {
      try {
        setIsLoading(true);
        const response = await fetch(
          `/api/agent/inbox/conversations/${conversationId}/reply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message_text: text }),
          }
        );
        if (!response.ok) return null;
        const msg: InboxMessageSnapshot = await response.json();
        // Refresh conversation detail
        await fetchConversationDetail(conversationId);
        await fetchConversations();
        return msg;
      } catch {
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchConversationDetail, fetchConversations]
  );

  const sendNewMessage = useCallback(
    async (recipient: string, text: string, goal: string): Promise<InboxMessageSnapshot | null> => {
      try {
        setIsLoading(true);
        const response = await fetch("/api/agent/inbox/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recipient, message: text, goal }),
        });
        if (!response.ok) return null;
        const msg: InboxMessageSnapshot = await response.json();
        await fetchConversations();
        await fetchUnreadCount();
        return msg;
      } catch {
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchConversations, fetchUnreadCount]
  );

  const completeGoal = useCallback(
    async (conversationId: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `/api/agent/inbox/conversations/${conversationId}/complete`,
          { method: "POST" }
        );
        if (response.ok) {
          await fetchConversations();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchConversations]
  );

  const cancelGoal = useCallback(
    async (conversationId: string): Promise<boolean> => {
      try {
        const response = await fetch(
          `/api/agent/inbox/conversations/${conversationId}/cancel`,
          { method: "POST" }
        );
        if (response.ok) {
          await fetchConversations();
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [fetchConversations]
  );

  const fetchSettings = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/inbox/settings");
      if (!response.ok) return;
      const data: InboxSettings = await response.json();
      setSettings(data);
    } catch {
      // Ignore
    }
  }, []);

  const updateSettings = useCallback(async (newSettings: InboxSettings) => {
    try {
      const response = await fetch("/api/agent/inbox/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings),
      });
      if (response.ok) {
        const data: InboxSettings = await response.json();
        setSettings(data);
      }
    } catch {
      // Ignore
    }
  }, []);

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
    fetchUnreadCount();

    // Set up polling interval — slower when SSE is connected
    const interval = slowMode ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    intervalRef.current = setInterval(fetchUnreadCount, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, slowMode, fetchUnreadCount]);

  return {
    unreadCount,
    conversations,
    conversationDetail,
    settings,
    isLoading,
    fetchUnreadCount,
    fetchConversations,
    fetchConversationDetail,
    markRead,
    sendReply,
    sendNewMessage,
    completeGoal,
    cancelGoal,
    fetchSettings,
    updateSettings,
  };
}
