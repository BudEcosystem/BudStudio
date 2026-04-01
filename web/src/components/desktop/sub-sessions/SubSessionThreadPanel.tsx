"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { X, ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useSubSessionThread } from "@/lib/desktop/useSubSessionThread";
import type { SubSessionStatus } from "@/lib/desktop/subSessionTypes";
import {
  convertBackendMessages,
  type AgentMessage,
  type BackendMessageSnapshot,
  type BackendHistoryResponse,
} from "../AgentSessionContext";
import { AgentMessageList } from "../AgentMessageList";
import ChatInputBar from "@/app/chat/components/input/ChatInputBar";
import { useChatContext } from "@/refresh-components/contexts/ChatContext";
import { useAgentsContext } from "@/refresh-components/contexts/AgentsContext";
import { useLlmManager, useFilters } from "@/lib/hooks";
import {
  useAgentSocket,
  createToolCallInfo,
  updateToolCallWithResult,
  useChatInteractionState,
  type SubSessionStreamEvent,
} from "@/lib/desktop";
import type { Packet } from "@/app/chat/services/streamingModels";

export interface SubSessionThreadPanelProps {
  sessionId: string | null;
  onClose: () => void;
  /** @deprecated No longer used. Kept for backward compatibility. */
  progressTrigger?: number;
  /** @deprecated No longer used. The panel uses its own Socket.IO connection. */
  streamEvents?: SubSessionStreamEvent[];
}

/**
 * Badge variant for each sub-session status.
 */
function statusBadgeVariant(
  status: SubSessionStatus
): "in_progress" | "success" | "destructive" {
  switch (status) {
    case "ACTIVE":
      return "in_progress";
    case "COMPLETED":
      return "success";
    case "FAILED":
      return "destructive";
  }
}

/**
 * Returns the backend URL (mirrors BudAgentScreen).
 */
const BACKEND_URL =
  process.env.NEXT_PUBLIC_BUD_BACKEND_URL?.trim() || "http://127.0.0.1:8080";

/**
 * Returns the workspace path (mirrors BudAgentScreen).
 */
function getWorkspacePath(): string {
  const envPath = process.env.NEXT_PUBLIC_BUD_WORKSPACE_PATH;
  if (envPath && envPath.trim()) return envPath.trim();
  if (typeof window !== "undefined") {
    const storedPath = localStorage.getItem("bud-workspace-path");
    if (storedPath && storedPath.trim()) return storedPath.trim();
  }
  return "/tmp/bud-workspace";
}

/**
 * Right-side drawer panel for viewing a sub-session's thread.
 *
 * Reuses the same components as BudAgentScreen: AgentMessageList for
 * message rendering and ChatInputBar for input. Connects its own
 * Socket.IO instance via useAgentSocket for real-time streaming,
 * exactly like the main chat does.
 */
export function SubSessionThreadPanel({
  sessionId,
  onClose,
}: SubSessionThreadPanelProps) {
  const {
    isLoading: isThreadMetaLoading,
    session,
    openThread,
    closeThread,
  } = useSubSessionThread();

  // Chat interaction state (same hook as BudAgentScreen)
  const {
    message,
    setMessage,
    isProcessing,
    setIsProcessing,
    chatState,
    setChatState,
    accumulatedContentRef,
    thinkingContentRef,
    toolCallsRef,
    packetsRef,
    messageFinalizedRef,
    currentAgentMessageIdRef,
    resetStreamingRefs,
  } = useChatInteractionState();

  // Socket.IO connection for this sub-session (separate from parent's)
  const { execute, joinSession, stop } = useAgentSocket(BACKEND_URL, "", { forceNew: true });

  // Providers from parent context (already available in the tree)
  const { llmProviders } = useChatContext();
  const { agents: availableAssistants, currentAgent } = useAgentsContext();
  const llmManager = useLlmManager(llmProviders);
  const filterManager = useFilters();
  const selectedAssistant = currentAgent || availableAssistants[0] || null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  // History-based messages (converted to AgentMessage format)
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);


  // ── Message management (mirrors BudAgentScreen pattern) ──
  // We manage messages locally since we don't have an AgentSessionContext
  // for this sub-session.

  const agentMessagesRef = useRef<AgentMessage[]>([]);
  agentMessagesRef.current = agentMessages;

  /**
   * Add a message to the local messages list.
   */
  const addLocalMessage = useCallback(
    (msg: Omit<AgentMessage, "id" | "timestamp">): AgentMessage => {
      const newMsg: AgentMessage = {
        ...msg,
        id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date(),
      };
      setAgentMessages((prev) => [...prev, newMsg]);
      return newMsg;
    },
    []
  );

  /**
   * Update a specific message by ID.
   */
  const updateLocalMessage = useCallback(
    (
      messageId: string,
      updates: Partial<Omit<AgentMessage, "id" | "timestamp" | "role">>
    ) => {
      setAgentMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ...updates } : m))
      );
    },
    []
  );

  /**
   * Fetch the session history using the standard endpoint and convert
   * messages to AgentMessage format (same pipeline as BudAgentScreen).
   */
  const fetchHistory = useCallback(async (sid: string) => {
    setIsLoadingHistory(true);
    try {
      const resp = await fetch(`/api/agent/sessions/${sid}/history`);
      if (!resp.ok) {
        console.error("Failed to fetch sub-session history:", resp.status);
        return;
      }
      const data = (await resp.json()) as BackendHistoryResponse;
      const messages = convertBackendMessages(
        data.messages as BackendMessageSnapshot[]
      );

      // Map packet turns to agent messages.
      // Packets are grouped by user-message turns. Agent messages may be
      // split further (e.g. when a sub-session result is injected).
      // Assign each packet turn to the first agent message that has
      // toolCalls (it needs packets for MultiToolRenderer), or the
      // first agent message if none have toolCalls.
      if (data.packets && data.packets.length > 0) {
        const agentMsgs = messages.filter((m) => m.role === "agent");
        let agentIdx = 0;
        for (let turnIdx = 0; turnIdx < data.packets.length; turnIdx++) {
          const packetTurn = data.packets[turnIdx];
          if (!packetTurn || packetTurn.length === 0) continue;

          // Find the next agent message that has toolCalls (needs packets)
          // or just the next one if none have toolCalls
          while (
            agentIdx < agentMsgs.length - 1 &&
            agentMsgs[agentIdx] &&
            (!agentMsgs[agentIdx].toolCalls || agentMsgs[agentIdx].toolCalls!.length === 0) &&
            !agentMsgs[agentIdx].content
          ) {
            agentIdx++;
          }

          if (agentIdx < agentMsgs.length) {
            agentMsgs[agentIdx].packets = packetTurn as unknown as Packet[];
            agentIdx++;
          }
        }
      }

      setAgentMessages(messages);
    } catch (err) {
      console.error("Error fetching sub-session history:", err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  // Open thread metadata + fetch history when sessionId changes
  useEffect(() => {
    if (sessionId) {
      openThread(sessionId);
      fetchHistory(sessionId);
      // Reset chat state for new session
      setIsProcessing(false);
      setChatState("input");
      resetStreamingRefs();
    } else {
      closeThread();
      setAgentMessages([]);
      setIsProcessing(false);
      setChatState("input");
      resetStreamingRefs();
    }
  }, [sessionId, openThread, closeThread, fetchHistory]);

  // Auto-scroll only when message count increases (new messages), not on initial load
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (agentMessages.length > prevMessageCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMessageCountRef.current = agentMessages.length;
  }, [agentMessages]);

  // Track the live streaming message from background Celery execution.
  // Using a ref so the Socket.IO callbacks always see the latest value.
  const bgStreamMsgIdRef = useRef<string | null>(null);
  const bgStreamAccRef = useRef<string>("");

  // Join the sub-session's Socket.IO room to receive streaming events
  // from background Celery execution (via Redis pub/sub → Socket.IO bridge).
  useEffect(() => {
    if (!sessionId || isProcessing) return;

    // Reset stream state when session changes
    bgStreamMsgIdRef.current = null;
    bgStreamAccRef.current = "";

    joinSession(sessionId, {
      onText: (content: string) => {
        if (!bgStreamMsgIdRef.current) {
          // First text delta — create a new streaming message at the end
          const msg = addLocalMessage({ role: "agent", content, status: "streaming" });
          bgStreamMsgIdRef.current = msg.id;
          bgStreamAccRef.current = content;
        } else {
          bgStreamAccRef.current += content;
          updateLocalMessage(bgStreamMsgIdRef.current, {
            content: bgStreamAccRef.current,
            status: "streaming",
          });
        }
      },

      onThinking: () => {
        if (!bgStreamMsgIdRef.current) {
          const msg = addLocalMessage({ role: "agent", content: "", status: "thinking" });
          bgStreamMsgIdRef.current = msg.id;
        } else {
          updateLocalMessage(bgStreamMsgIdRef.current, { status: "thinking" });
        }
      },

      onThinkingDelta: (content: string) => {
        if (bgStreamMsgIdRef.current) {
          updateLocalMessage(bgStreamMsgIdRef.current, {
            status: "thinking",
            thinkingContent: content,
          });
        }
      },

      onPacket: (packet) => {
        // Create the stream message on first packet if it doesn't exist
        // (tool:start can arrive before onThinking/onText)
        if (!bgStreamMsgIdRef.current) {
          const msg = addLocalMessage({ role: "agent", content: "", status: "streaming" });
          bgStreamMsgIdRef.current = msg.id;
        }
        packetsRef.current = [...packetsRef.current, packet];
        updateLocalMessage(bgStreamMsgIdRef.current, {
          packets: [...packetsRef.current],
        });
      },

      onDone: () => {
        // Mark stream message complete, clear refs
        if (bgStreamMsgIdRef.current) {
          updateLocalMessage(bgStreamMsgIdRef.current, { status: "complete" });
        }
        bgStreamMsgIdRef.current = null;
        bgStreamAccRef.current = "";
        packetsRef.current = [];

        // Delayed reload from DB to replace stream message with persisted version.
        // The delay ensures the Celery worker has committed the message to DB.
        if (sessionId) {
          setTimeout(() => {
            fetchHistory(sessionId);
            openThread(sessionId);
          }, 1000);
        }
      },

      onComplete: (content: string) => {
        if (bgStreamMsgIdRef.current) {
          updateLocalMessage(bgStreamMsgIdRef.current, {
            content: content || bgStreamAccRef.current,
            status: "complete",
          });
        }
        bgStreamMsgIdRef.current = null;
        bgStreamAccRef.current = "";
      },
    });
  }, [sessionId, isProcessing]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Submit a message to the sub-session via Socket.IO.
   * Mirrors handleSubmit in BudAgentScreen.
   */
  const handleSubmit = useCallback(
    async (overrideMessage?: string) => {
      const effectiveMessage = overrideMessage ?? message;
      if (!effectiveMessage.trim() || !sessionId) return;

      // If already processing, stop first
      if (isProcessing) {
        stop(sessionId);
        setIsProcessing(false);
        setChatState("input");
        resetStreamingRefs();
      }

      const userMessage = effectiveMessage.trim();

      // Add user message locally
      addLocalMessage({ role: "user", content: userMessage });

      // Clear input and set processing state
      setMessage("");
      setIsProcessing(true);
      setChatState("streaming");
      resetStreamingRefs();

      // Create initial agent message
      const agentMsg = addLocalMessage({
        role: "agent",
        content: "",
        status: "thinking",
      });
      currentAgentMessageIdRef.current = agentMsg.id;

      const activeMessageId = agentMsg.id;

      const updateAgentMsg = (
        updates: Partial<Omit<AgentMessage, "id" | "timestamp" | "role">>
      ) => {
        updateLocalMessage(activeMessageId, updates);
      };

      // Execute via Socket.IO
      execute(
        {
          sessionId,
          message: userMessage,
          workspacePath: getWorkspacePath(),
          model: llmManager.currentLlm.modelName || undefined,
        },
        {
          onPacket: (packet) => {
            packetsRef.current = [...packetsRef.current, packet];
            updateAgentMsg({ packets: [...packetsRef.current] });
          },

          onThinking: () => {
            updateAgentMsg({ status: "thinking" });
          },

          onThinkingDelta: (content) => {
            thinkingContentRef.current += content;
            updateAgentMsg({
              status: "thinking",
              thinkingContent: thinkingContentRef.current,
            });
          },

          onText: (content) => {
            accumulatedContentRef.current += content;
            updateAgentMsg({
              content: accumulatedContentRef.current,
              status: "streaming",
            });
          },

          onToolStart: (toolName, toolInput, toolCallId) => {
            const newToolCall = createToolCallInfo(
              toolName,
              toolInput,
              toolCallId
            );
            toolCallsRef.current = [...toolCallsRef.current, newToolCall];
            updateAgentMsg({
              toolCalls: toolCallsRef.current,
              status: "streaming",
            });
          },

          onToolResult: (toolName, toolOutput, toolError, toolCallId) => {
            toolCallsRef.current = updateToolCallWithResult(
              toolCallsRef.current,
              toolCallId,
              toolOutput,
              toolError
            );
            updateAgentMsg({ toolCalls: toolCallsRef.current });
          },

          onComplete: (content) => {
            messageFinalizedRef.current = true;
            updateAgentMsg({
              content: content || accumulatedContentRef.current,
              status: "complete",
            });
          },

          onError: (error) => {
            messageFinalizedRef.current = true;
            const existing = accumulatedContentRef.current;
            updateAgentMsg({
              content: existing
                ? `${existing}\n\n**Error:** ${error}`
                : `Error: ${error}`,
              status: "error",
            });
          },

          onStopped: () => {
            messageFinalizedRef.current = true;
            updateAgentMsg({
              content:
                accumulatedContentRef.current ||
                "Agent execution was stopped.",
              status: "stopped",
            });
          },

          onDone: () => {
            if (!messageFinalizedRef.current) {
              updateAgentMsg({
                content: accumulatedContentRef.current || "",
                status: "complete",
              });
            }
            setIsProcessing(false);
            setChatState("input");
            currentAgentMessageIdRef.current = null;
            // Refresh thread metadata (turn count, status, etc.)
            openThread(sessionId);
          },
        }
      );
    },
    [
      message,
      sessionId,
      isProcessing,
      execute,
      stop,
      addLocalMessage,
      updateLocalMessage,
      openThread,
      llmManager.currentLlm.modelName,
    ]
  );

  const stopProcessing = useCallback(() => {
    if (sessionId) {
      stop(sessionId);
    }
    setIsProcessing(false);
    setChatState("input");
  }, [stop, sessionId]);

  // No-op handlers for ChatInputBar props we don't use
  const noOp = useCallback(() => {}, []);
  const handleFileUpload = useCallback((_files: File[]) => {}, []);

  if (!sessionId) return null;

  const isLoading = isThreadMetaLoading || isLoadingHistory;

  return (
    <div className="flex flex-col h-full w-[400px] max-w-[90vw] border-l border-border bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-background-tint-02 text-text-03 transition-colors"
          aria-label="Close thread panel"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-04 truncate">
            {session?.task_name ?? "Sub-session"}
          </p>
          {session?.task && session.task !== session.task_name && (
            <p className="text-xs text-text-02 mt-0.5 line-clamp-2">
              {session.task}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {session && (
              <Badge variant={statusBadgeVariant(session.status)} size="xs">
                {session.status}
              </Badge>
            )}
            {session?.status === "ACTIVE" && (
              <span className="flex items-center gap-1 text-xs font-medium text-green-500">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
                Live
              </span>
            )}
            {session && (
              <span className="text-xs text-text-02">
                {session.turns_completed} turn
                {session.turns_completed !== 1 ? "s" : ""}
                {session.tokens_used > 0 &&
                  ` / ${session.tokens_used.toLocaleString()} tokens`}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-background-tint-02 text-text-03 transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body: scrollable messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {isLoading && agentMessages.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-text-03 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-text-03">
              Loading thread...
            </span>
          </div>
        ) : agentMessages.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <span className="ml-2 text-sm text-text-03">Working...</span>
          </div>
        ) : (
          <AgentMessageList messages={agentMessages} compact />
        )}
      </div>

      {/* Footer: Cancel button + ChatInputBar */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <ChatInputBar
          message={message}
          setMessage={setMessage}
          onSubmit={handleSubmit}
          stopGenerating={stopProcessing}
          chatState={chatState}
          llmManager={llmManager}
          filterManager={filterManager}
          selectedAssistant={selectedAssistant ?? { id: 0, name: "Agent", description: "" }}
          selectedDocuments={[]}
          removeDocs={noOp}
          toggleDocumentSidebar={noOp}
          handleFileUpload={handleFileUpload}
          textAreaRef={textAreaRef}
          retrievalEnabled={false}
          deepResearchEnabled={false}
          toggleDeepResearch={noOp}
          currentSessionFileTokenCount={0}
          availableContextTokens={120000}
        />
      </div>
    </div>
  );
}
