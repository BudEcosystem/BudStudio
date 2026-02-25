"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { useIsDesktop } from "@/lib/desktop";
import { useInboxPolling } from "@/lib/desktop/useInboxPolling";
import type {
  ConversationListItem,
  ConversationDetail,
  InboxMessageSnapshot,
  InboxSettings,
} from "@/lib/agent/types";

interface InboxContextType {
  unreadCount: number;
  conversations: ConversationListItem[];
  selectedConversationId: string | null;
  conversationDetail: ConversationDetail | null;
  settings: InboxSettings;
  isLoading: boolean;
  selectConversation: (conversationId: string | null) => Promise<void>;
  sendReply: (conversationId: string, text: string) => Promise<InboxMessageSnapshot | null>;
  sendNewMessage: (recipient: string, text: string) => Promise<InboxMessageSnapshot | null>;
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
  const polling = useInboxPolling(isDesktop);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

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
      markRead: async () => {},
      fetchConversations: async () => {},
      fetchSettings: async () => {},
      updateSettings: async () => {},
    };
  }
  return context;
}
