"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { useIsDesktop } from "@/lib/desktop";
import { useInboxPolling } from "@/lib/desktop/useInboxPolling";
import { useEventStreamContext } from "./EventStreamContext";
import type {
  ConversationListItem,
  ConversationDetail,
  InboxMessageSnapshot,
  InboxSettings,
} from "@/lib/agent/types";
import type { EventStreamEvent } from "@/lib/desktop/useEventStream";

interface InboxContextType {
  unreadCount: number;
  conversations: ConversationListItem[];
  selectedConversationId: string | null;
  conversationDetail: ConversationDetail | null;
  settings: InboxSettings;
  isLoading: boolean;
  selectConversation: (conversationId: string | null) => Promise<void>;
  sendReply: (conversationId: string, text: string) => Promise<InboxMessageSnapshot | null>;
  sendNewMessage: (recipient: string, text: string, goal: string) => Promise<InboxMessageSnapshot | null>;
  completeGoal: (conversationId: string) => Promise<boolean>;
  cancelGoal: (conversationId: string) => Promise<boolean>;
  markRead: (conversationId: string) => Promise<void>;
  fetchConversations: () => Promise<void>;
  fetchSettings: () => Promise<void>;
  updateSettings: (settings: InboxSettings) => Promise<void>;
}

const InboxContext = createContext<InboxContextType | undefined>(undefined);

interface InboxProviderProps {
  children: ReactNode;
}

export function InboxProvider({ children }: InboxProviderProps) {
  const isDesktop = useIsDesktop();
  const { connected, registerHandler, unregisterHandler } =
    useEventStreamContext();
  const polling = useInboxPolling(isDesktop, connected);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  // Register handlers for real-time inbox events
  useEffect(() => {
    const handleInboxMessage = (event: EventStreamEvent) => {
      // Refresh unread count and conversation list
      polling.fetchUnreadCount();
      polling.fetchConversations();

      // If the event is for the currently selected conversation, refresh detail
      const eventConvId = event.data.conversation_id as string | undefined;
      if (eventConvId && eventConvId === selectedConversationId) {
        polling.fetchConversationDetail(eventConvId);
      }
    };

    const handleStatusChange = (_event: EventStreamEvent) => {
      // Refresh conversations to pick up status updates
      polling.fetchConversations();
    };

    registerHandler("inbox_message", handleInboxMessage);
    registerHandler("inbox_status_change", handleStatusChange);

    return () => {
      unregisterHandler("inbox_message", handleInboxMessage);
      unregisterHandler("inbox_status_change", handleStatusChange);
    };
  }, [
    registerHandler,
    unregisterHandler,
    polling,
    selectedConversationId,
  ]);

  const selectConversation = useCallback(
    async (conversationId: string | null) => {
      setSelectedConversationId(conversationId);
      if (conversationId) {
        await polling.fetchConversationDetail(conversationId);
        await polling.markRead(conversationId);
      }
    },
    [polling]
  );

  return (
    <InboxContext.Provider
      value={{
        unreadCount: polling.unreadCount,
        conversations: polling.conversations,
        selectedConversationId,
        conversationDetail: polling.conversationDetail,
        settings: polling.settings,
        isLoading: polling.isLoading,
        selectConversation,
        sendReply: polling.sendReply,
        sendNewMessage: polling.sendNewMessage,
        completeGoal: polling.completeGoal,
        cancelGoal: polling.cancelGoal,
        markRead: polling.markRead,
        fetchConversations: polling.fetchConversations,
        fetchSettings: polling.fetchSettings,
        updateSettings: polling.updateSettings,
      }}
    >
      {children}
    </InboxContext.Provider>
  );
}

export function useInbox(): InboxContextType {
  const context = useContext(InboxContext);
  if (context === undefined) {
    return {
      unreadCount: 0,
      conversations: [],
      selectedConversationId: null,
      conversationDetail: null,
      settings: { auto_reply_enabled: true, reply_depth_limit: null },
      isLoading: false,
      selectConversation: async () => {},
      sendReply: async () => null,
      sendNewMessage: async () => null,
      completeGoal: async () => false,
      cancelGoal: async () => false,
      markRead: async () => {},
      fetchConversations: async () => {},
      fetchSettings: async () => {},
      updateSettings: async () => {},
    };
  }
  return context;
}
