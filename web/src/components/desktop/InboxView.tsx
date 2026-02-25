"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useInbox } from "./InboxContext";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import type { InboxSettings } from "@/lib/agent/types";

function formatTimestamp(ts: string | null): string {
  if (!ts) return "";
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getInitial(name: string | null, email: string | null): string {
  if (name) return name.charAt(0).toUpperCase();
  if (email) return email.charAt(0).toUpperCase();
  return "?";
}

export function InboxView() {
  const {
    conversations,
    selectedConversationId,
    conversationDetail,
    settings,
    isLoading,
    selectConversation,
    sendReply,
    sendNewMessage,
    fetchConversations,
    fetchSettings,
    updateSettings,
  } = useInbox();

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [replyText, setReplyText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showNewMessage, setShowNewMessage] = useState(false);
  const [newRecipient, setNewRecipient] = useState("");
  const [newMessageText, setNewMessageText] = useState("");
  const [localSettings, setLocalSettings] = useState<InboxSettings>(settings);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
    fetchSettings();
  }, [fetchConversations, fetchSettings]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationDetail?.messages]);

  const handleSendReply = useCallback(async () => {
    if (!selectedConversationId || !replyText.trim()) return;
    await sendReply(selectedConversationId, replyText.trim());
    setReplyText("");
  }, [selectedConversationId, replyText, sendReply]);

  const handleSendNew = useCallback(async () => {
    if (!newRecipient.trim() || !newMessageText.trim()) return;
    const msg = await sendNewMessage(newRecipient.trim(), newMessageText.trim());
    if (msg) {
      setNewRecipient("");
      setNewMessageText("");
      setShowNewMessage(false);
      await fetchConversations();
      await selectConversation(msg.conversation_id);
    }
  }, [newRecipient, newMessageText, sendNewMessage, fetchConversations, selectConversation]);

  const handleSaveSettings = useCallback(async () => {
    await updateSettings(localSettings);
    setShowSettings(false);
  }, [localSettings, updateSettings]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className={cn(
        "flex items-center justify-between px-6 py-4 border-b",
        isDark ? "border-white/10" : "border-gray-200"
      )}>
        <h1 className="text-lg font-semibold">Inbox</h1>
        <div className="flex gap-2">
          <button
            onClick={() => { setShowNewMessage(!showNewMessage); setShowSettings(false); }}
            className={cn(
              "px-3 py-1.5 text-sm rounded-lg transition-colors",
              isDark
                ? "bg-white/10 hover:bg-white/20 text-white"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            )}
          >
            New Message
          </button>
          <button
            onClick={() => { setShowSettings(!showSettings); setShowNewMessage(false); }}
            className={cn(
              "px-3 py-1.5 text-sm rounded-lg transition-colors",
              isDark
                ? "bg-white/10 hover:bg-white/20 text-white"
                : "bg-gray-100 hover:bg-gray-200 text-gray-700"
            )}
          >
            Settings
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className={cn(
          "px-6 py-4 border-b",
          isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"
        )}>
          <div className="flex flex-col gap-3 max-w-md">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={localSettings.auto_reply_enabled}
                onChange={(e) => setLocalSettings({ ...localSettings, auto_reply_enabled: e.target.checked })}
                className="rounded"
              />
              <span className="text-sm">Auto-reply enabled</span>
            </label>
            <label className="flex items-center gap-3">
              <span className="text-sm min-w-[140px]">Preferred reply limit:</span>
              <input
                type="number"
                min={1}
                placeholder="Unlimited"
                value={localSettings.reply_depth_limit ?? ""}
                onChange={(e) => setLocalSettings({
                  ...localSettings,
                  reply_depth_limit: e.target.value ? parseInt(e.target.value) : null,
                })}
                className={cn(
                  "w-24 px-2 py-1 text-sm rounded border",
                  isDark ? "bg-white/10 border-white/20" : "bg-white border-gray-300"
                )}
              />
            </label>
            <button
              onClick={handleSaveSettings}
              className="self-start px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* New message panel */}
      {showNewMessage && (
        <div className={cn(
          "px-6 py-4 border-b",
          isDark ? "border-white/10 bg-white/5" : "border-gray-200 bg-gray-50"
        )}>
          <div className="flex flex-col gap-3 max-w-lg">
            <input
              type="text"
              placeholder="Recipient (email or name)"
              value={newRecipient}
              onChange={(e) => setNewRecipient(e.target.value)}
              className={cn(
                "px-3 py-2 text-sm rounded-lg border",
                isDark ? "bg-white/10 border-white/20" : "bg-white border-gray-300"
              )}
            />
            <textarea
              placeholder="Message..."
              value={newMessageText}
              onChange={(e) => setNewMessageText(e.target.value)}
              rows={3}
              className={cn(
                "px-3 py-2 text-sm rounded-lg border resize-none",
                isDark ? "bg-white/10 border-white/20" : "bg-white border-gray-300"
              )}
            />
            <button
              onClick={handleSendNew}
              disabled={!newRecipient.trim() || !newMessageText.trim()}
              className="self-start px-4 py-1.5 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Main two-panel layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: conversation list */}
        <div className={cn(
          "w-80 flex-shrink-0 border-r overflow-y-auto",
          isDark ? "border-white/10" : "border-gray-200"
        )}>
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No conversations yet
            </div>
          ) : (
            conversations.map((conv) => (
              <button
                key={conv.conversation_id}
                onClick={() => selectConversation(conv.conversation_id)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b transition-colors",
                  isDark ? "border-white/5" : "border-gray-100",
                  selectedConversationId === conv.conversation_id
                    ? (isDark ? "bg-white/10" : "bg-purple-50")
                    : (isDark ? "hover:bg-white/5" : "hover:bg-gray-50")
                )}
              >
                <div className="flex items-start gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0",
                    isDark ? "bg-purple-600/30 text-purple-300" : "bg-purple-100 text-purple-700"
                  )}>
                    {getInitial(conv.other_participant_name, conv.other_participant_email)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        "text-sm truncate",
                        conv.unread_count > 0 ? "font-semibold" : "font-medium"
                      )}>
                        {conv.other_participant_name || conv.other_participant_email || "Unknown"}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {conv.unread_count > 0 && (
                          <span className="w-2 h-2 rounded-full bg-purple-500" />
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(conv.last_message_at)}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {conv.last_message_preview || "No messages"}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right panel: message thread */}
        <div className="flex-1 flex flex-col min-h-0">
          {!selectedConversationId ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Select a conversation to view messages
            </div>
          ) : !conversationDetail ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {isLoading ? "Loading..." : "No conversation data"}
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className={cn(
                "px-6 py-3 border-b flex-shrink-0",
                isDark ? "border-white/10" : "border-gray-200"
              )}>
                {conversationDetail.participants
                  .filter((p) => p.user_id !== conversationDetail.participants[0]?.user_id || conversationDetail.participants.length === 1)
                  .slice(0, 1)
                  .map((p) => (
                    <div key={p.user_id}>
                      <span className="font-medium text-sm">{p.name || p.email || "Unknown"}</span>
                      {p.email && p.name && (
                        <span className="text-xs text-muted-foreground ml-2">{p.email}</span>
                      )}
                    </div>
                  ))}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                {conversationDetail.messages.map((msg) => {
                  const isAgent = msg.sender_type === "agent";
                  return (
                    <div key={msg.id} className="flex flex-col">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={cn(
                          "text-xs font-medium",
                          isAgent ? (isDark ? "text-purple-400" : "text-purple-600") : "text-foreground"
                        )}>
                          {isAgent
                            ? `${msg.sender_name || "Agent"}'s Agent`
                            : (msg.sender_name || msg.sender_email || "Unknown")}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(msg.created_at)}
                        </span>
                      </div>
                      <div className={cn(
                        "px-3 py-2 rounded-lg text-sm max-w-[80%]",
                        isAgent
                          ? (isDark ? "bg-purple-600/20 text-purple-100" : "bg-purple-50 text-purple-900")
                          : (isDark ? "bg-white/10" : "bg-gray-100")
                      )}>
                        {msg.content}
                      </div>
                      {msg.agent_processing_status === "pending" && (
                        <span className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                          <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          Waiting for agent...
                        </span>
                      )}
                      {msg.agent_processing_status === "processing" && (
                        <span className="text-xs text-purple-500 mt-1 flex items-center gap-1">
                          <span className="inline-block w-3 h-3 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                          Agent is working...
                        </span>
                      )}
                      {msg.agent_processing_status === "failed" && (
                        <span className="text-xs text-red-500 mt-1">
                          {msg.error_message || "Agent processing failed"}
                        </span>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Reply input */}
              <div className={cn(
                "px-6 py-3 border-t flex gap-2 flex-shrink-0",
                isDark ? "border-white/10" : "border-gray-200"
              )}>
                <input
                  type="text"
                  placeholder="Type a reply..."
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendReply();
                    }
                  }}
                  className={cn(
                    "flex-1 px-3 py-2 text-sm rounded-lg border",
                    isDark ? "bg-white/10 border-white/20" : "bg-white border-gray-300"
                  )}
                />
                <button
                  onClick={handleSendReply}
                  disabled={!replyText.trim()}
                  className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
                >
                  Send
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
