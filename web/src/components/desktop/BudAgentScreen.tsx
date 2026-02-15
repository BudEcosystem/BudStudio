"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo/Logo";
import {
  useAgentSession,
  AgentMessage,
  ToolCallInfo,
} from "./AgentSessionContext";
import { MemoryUpdateDialog } from "./MemoryUpdateDialog";
import { InlineToolApproval } from "./InlineToolApproval";
import ChatInputBar from "@/app/chat/components/input/ChatInputBar";
import { useChatContext } from "@/refresh-components/contexts/ChatContext";
import { useAgentsContext } from "@/refresh-components/contexts/AgentsContext";
import { useLlmManager, useFilters } from "@/lib/hooks";
import { useProjectsContext } from "@/app/chat/projects/ProjectsContext";
import { ChatState } from "@/app/chat/interfaces";
import {
  useAgentSSE,
  createToolCallInfo,
  updateToolCallWithResult,
  updateToolCallApprovalRequired,
} from "@/lib/desktop";
import { isMemoryFile } from "@/lib/agent/utils/memory-detector";
import { FiTool, FiCheck, FiX, FiAlertCircle } from "react-icons/fi";
import { useMarkdownRenderer } from "@/app/chat/message/messageComponents/markdownUtils";
import { copyAll } from "@/app/chat/message/copyingUtils";
import AgentIcon from "@/refresh-components/AgentIcon";
import IconButton from "@/refresh-components/buttons/IconButton";
import SvgCopy from "@/icons/copy";
import SvgCheck from "@/icons/check";
import SvgArrowWallRight from "@/icons/arrow-wall-right";
import SvgSearchMenu from "@/icons/search-menu";
import Text from "@/refresh-components/texts/Text";
import { ChatDocumentDisplay } from "@/app/chat/components/documentSidebar/ChatDocumentDisplay";
import { removeDuplicateDocs } from "@/lib/documentUtils";
import { Separator } from "@radix-ui/react-separator";
import { BlinkingDot } from "@/app/chat/message/BlinkingDot";
import { BudAgentSkeleton } from "./BudAgentSkeleton";
import CitedSourcesToggle from "@/app/chat/message/messageComponents/CitedSourcesToggle";

import { useTheme } from "next-themes";
import type {
  Packet,
  SearchToolDelta,
  FetchToolStart,
  CitationDelta,
  StreamingCitation,
} from "@/app/chat/services/streamingModels";
import type { OnyxDocument } from "@/lib/search/interfaces";
import type { FullChatState } from "@/app/chat/message/messageComponents/interfaces";
import { groupPacketsByInd } from "@/app/chat/services/packetUtils";
import { PacketType } from "@/app/chat/services/streamingModels";
import MultiToolRenderer from "@/app/chat/message/messageComponents/MultiToolRenderer";

/**
 * Interface for a pending memory update request.
 */
interface PendingMemoryUpdate {
  toolCallId: string;
  toolName: string;
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Default fallback workspace path used when no configuration is provided.
 * In Docker/server deployments this directory is auto-created by the API route.
 */
const FALLBACK_WORKSPACE_PATH = "/tmp/bud-workspace";

/**
 * Returns the workspace path from (in priority order):
 * 1. NEXT_PUBLIC_BUD_WORKSPACE_PATH environment variable
 * 2. localStorage key "bud-workspace-path"
 * 3. FALLBACK_WORKSPACE_PATH
 */
function getWorkspacePath(): string {
  // 1. Environment variable (set at build/deploy time)
  const envPath = process.env.NEXT_PUBLIC_BUD_WORKSPACE_PATH;
  if (envPath && envPath.trim()) {
    return envPath.trim();
  }

  // 2. localStorage (set by user or Tauri desktop app)
  if (typeof window !== "undefined") {
    const storedPath = localStorage.getItem("bud-workspace-path");
    if (storedPath && storedPath.trim()) {
      return storedPath.trim();
    }
  }

  // 3. Fallback
  return FALLBACK_WORKSPACE_PATH;
}

/**
 * Extract citation data and document map from an array of packets.
 * Returns { docs, citations, documentMap } for rendering popovers and sources.
 */
function extractCitationData(packets: Packet[]): {
  docs: OnyxDocument[];
  citations: StreamingCitation[];
  documentMap: Map<string, OnyxDocument>;
} {
  const documentMap = new Map<string, OnyxDocument>();
  const citations: StreamingCitation[] = [];
  const seenCitationDocIds = new Set<string>();

  for (const packet of packets) {
    // Collect documents from search/fetch tool packets
    if (
      packet.obj.type === PacketType.SEARCH_TOOL_DELTA ||
      packet.obj.type === PacketType.FETCH_TOOL_START
    ) {
      const toolObj = packet.obj as SearchToolDelta | FetchToolStart;
      if ("documents" in toolObj && toolObj.documents) {
        for (const doc of toolObj.documents) {
          if (doc.document_id) {
            documentMap.set(doc.document_id, doc);
          }
        }
      }
    }

    // Collect citations
    if (packet.obj.type === PacketType.CITATION_DELTA) {
      const citationObj = packet.obj as CitationDelta;
      if (citationObj.citations) {
        for (const citation of citationObj.citations) {
          if (!seenCitationDocIds.has(citation.document_id)) {
            seenCitationDocIds.add(citation.document_id);
            citations.push(citation);
          }
        }
      }
    }
  }

  // Build docs array indexed by citation number: docs[citation_num - 1] = document
  const docs: OnyxDocument[] = [];
  if (citations.length > 0) {
    // Find the max citation number to size the array
    const maxCitNum = Math.max(...citations.map((c) => c.citation_num));
    for (let i = 0; i < maxCitNum; i++) {
      const citation = citations.find((c) => c.citation_num === i + 1);
      if (citation) {
        const doc = documentMap.get(citation.document_id);
        if (doc) {
          docs[i] = doc;
        }
      }
    }
  }

  return { docs, citations, documentMap };
}

/**
 * Renders agent message content with full markdown support (code blocks, GFM tables, math, etc.)
 * When docs are provided, citation popovers are enabled (e.g., [1] shows tooltip on hover).
 */
function AgentMessageContent({
  content,
  docs,
  setPresentingDocument,
  assistant,
}: {
  content: string;
  docs?: OnyxDocument[] | null;
  setPresentingDocument?: (doc: OnyxDocument) => void;
  assistant?: { id: number; name: string; [key: string]: unknown } | null;
}) {
  const state = useMemo<FullChatState | undefined>(() => {
    if (!docs || docs.length === 0 || !assistant) return undefined;
    return {
      handleFeedback: () => {},
      assistant: assistant as FullChatState["assistant"],
      docs,
      setPresentingDocument: setPresentingDocument || (() => {}),
    };
  }, [docs, assistant, setPresentingDocument]);

  const { renderedContent } = useMarkdownRenderer(content, state, "text-base");
  return (
    <div className="overflow-x-visible max-w-content-max break-words">
      {renderedContent}
    </div>
  );
}

/**
 * BudAgent Screen - Autonomous agent chat interface
 * Uses SSE streaming from the local agent API for real-time updates
 */
export function BudAgentScreen() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatState, setChatState] = useState<ChatState>("input");
  const [pendingMemoryUpdate, setPendingMemoryUpdate] = useState<PendingMemoryUpdate | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [sidebarSourcesMsgId, setSidebarSourcesMsgId] = useState<string | null>(null);
  const [bottomApproval, setBottomApproval] = useState<{
    toolCallId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    operationHash: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentAgentMessageIdRef = useRef<string | null>(null);
  const accumulatedContentRef = useRef<string>("");
  const toolCallsRef = useRef<ToolCallInfo[]>([]);
  const packetsRef = useRef<Packet[]>([]);
  const messageFinalizedRef = useRef<boolean>(false);

  const {
    currentSession,
    currentSessionId,
    isLoading: isSessionLoading,
    switchToSession,
    addMessage,
    updateMessage,
    sessionPreferences,
    setAlwaysAllowTool,
    setAlwaysAllowMemoryUpdates,
    isToolAlwaysAllowed,
    createOperationHash,
    setAlwaysAllowOperation,
    isOperationAllowed,
  } = useAgentSession();

  // SSE streaming hook
  const { execute, abort } = useAgentSSE();

  // Get data from chat context (same providers wrap BudAgentScreen)
  const { llmProviders } = useChatContext();
  const { agents: availableAssistants, currentAgent } = useAgentsContext();
  const { setCurrentMessageFiles: _setCurrentMessageFiles } = useProjectsContext();

  // Set up hooks that ChatInputBar needs
  const llmManager = useLlmManager(llmProviders);
  const filterManager = useFilters();

  // Use the current agent or first available
  // The ChatInputBar requires a non-null assistant, so we'll render a placeholder if none available
  const selectedAssistant = currentAgent || availableAssistants[0] || null;

  // Minimal FullChatState for MultiToolRenderer (only needs handleFeedback + assistant)
  const minimalChatState = useMemo<FullChatState | null>(() => {
    if (!selectedAssistant) return null;
    return {
      handleFeedback: () => {},
      assistant: selectedAssistant,
    };
  }, [selectedAssistant]);

  const messages = currentSession?.messages || [];

  // Compute citation data for the sidebar-selected message
  const sidebarData = useMemo(() => {
    if (!sidebarSourcesMsgId) return null;
    const msg = messages.find((m) => m.id === sidebarSourcesMsgId);
    if (!msg?.packets || msg.packets.length === 0) return null;
    const data = extractCitationData(msg.packets);
    if (data.documentMap.size === 0) return null;
    return data;
  }, [sidebarSourcesMsgId, messages]);

  const closeSidebar = useCallback(() => {
    setSidebarSourcesMsgId(null);
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abort();
    };
  }, [abort]);

  /**
   * Update the current agent message with new content or tool calls.
   */
  const updateCurrentAgentMessage = useCallback(
    (updates: Partial<Omit<AgentMessage, "id" | "timestamp" | "role">>) => {
      if (currentAgentMessageIdRef.current && currentSessionId) {
        updateMessage(currentSessionId, currentAgentMessageIdRef.current, updates);
      }
    },
    [currentSessionId, updateMessage]
  );

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isProcessing) return;

    // The active session is auto-loaded by the context on mount.
    // If for some reason it's not available yet, bail out.
    const sessionId = currentSessionId;
    if (!sessionId) {
      console.error("No active session available");
      return;
    }

    const userMessage = message.trim();

    // Add user message
    addMessage(sessionId, {
      role: "user",
      content: userMessage,
    });

    // Clear input and set processing state
    setMessage("");
    setIsProcessing(true);
    setChatState("streaming");

    // Reset refs for new agent response
    accumulatedContentRef.current = "";
    toolCallsRef.current = [];
    packetsRef.current = [];
    messageFinalizedRef.current = false;

    // Create initial agent message (will be updated via streaming)
    const agentMsg = addMessage(sessionId, {
      role: "agent",
      content: "",
      status: "thinking",
    });
    currentAgentMessageIdRef.current = agentMsg.id;

    // Store sessionId and messageId in local variables for closure
    const activeSessionId = sessionId;
    const activeMessageId = agentMsg.id;

    // Helper to update the agent message using local variables (not stale state)
    const updateAgentMsg = (updates: Partial<Omit<AgentMessage, "id" | "timestamp" | "role">>) => {
      updateMessage(activeSessionId, activeMessageId, updates);
    };

    // Execute the agent via SSE
    execute(
      {
        sessionId: activeSessionId,
        message: userMessage,
        workspacePath: getWorkspacePath(),
      },
      {
        onPacket: (packet) => {
          packetsRef.current = [...packetsRef.current, packet];
          updateAgentMsg({ packets: [...packetsRef.current] });
        },

        onThinking: () => {
          updateAgentMsg({ status: "thinking" });
        },

        onText: (content) => {
          accumulatedContentRef.current += content;
          updateAgentMsg({
            content: accumulatedContentRef.current,
            status: "streaming",
          });
        },

        onToolStart: (toolName, toolInput, toolCallId) => {
          const newToolCall = createToolCallInfo(toolName, toolInput, toolCallId);
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
          updateAgentMsg({
            toolCalls: toolCallsRef.current,
          });
        },

        onApprovalRequired: async (toolName, toolInput, toolCallId) => {
          // Update the tool call status to show it's awaiting approval
          toolCallsRef.current = updateToolCallApprovalRequired(
            toolCallsRef.current,
            toolCallId
          );
          updateAgentMsg({
            toolCalls: toolCallsRef.current,
          });

          // Check if this is a memory file operation
          const filePath = toolInput.path as string | undefined;
          const isMemory = filePath && isMemoryFile(filePath);

          // Create operation hash for this specific operation
          const operationHash = createOperationHash(toolName, toolInput);

          // Check if we should auto-approve based on preferences
          // Priority 1: Check if this specific operation was approved
          if (isOperationAllowed(operationHash)) {
            handleToolApprove(toolCallId, false);
            return;
          }

          // Priority 2: Check if memory updates are always allowed
          if (isMemory && sessionPreferences.alwaysAllowMemoryUpdates) {
            handleToolApprove(toolCallId, false);
            return;
          }

          // Priority 3: Check if this tool type is always allowed (legacy)
          if (!isMemory && isToolAlwaysAllowed(toolName)) {
            handleToolApprove(toolCallId, false);
            return;
          }

          // For memory file operations, try to fetch the current content for diff
          if (isMemory && (toolName === "write_file" || toolName === "edit_file")) {
            try {
              // Try to read the current file content
              const response = await fetch("/api/local-agent/read-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  workspacePath: getWorkspacePath(),
                  filePath,
                }),
              });

              let oldContent = "";
              if (response.ok) {
                const data = await response.json();
                oldContent = data.content || "";
              }

              // Determine new content based on tool type
              let newContent = "";
              if (toolName === "write_file") {
                newContent = (toolInput.content as string) || "";
              } else if (toolName === "edit_file") {
                // For edit operations, apply the edit to show the result
                const oldText = toolInput.oldText as string;
                const newText = toolInput.newText as string;
                if (oldText && oldContent.includes(oldText)) {
                  newContent = oldContent.replace(oldText, newText || "");
                } else {
                  // Can't preview the edit, inline approval will show automatically
                  return;
                }
              }

              // Show the memory update dialog
              setPendingMemoryUpdate({
                toolCallId,
                toolName,
                filePath,
                oldContent,
                newContent,
              });
              return;
            } catch (error) {
              console.error("Failed to read file for memory update preview:", error);
              // Fall back to inline approval (will show automatically)
            }
          }

          // Show bottom approval UI
          setBottomApproval({
            toolCallId,
            toolName,
            toolInput,
            operationHash,
          });
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
          updateAgentMsg({
            content:
              accumulatedContentRef.current ||
              `Error: ${error}`,
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

        onSessionCompacted: (newSessionId) => {
          // Seamlessly switch to the new compacted session
          switchToSession(newSessionId);
        },

        onDone: () => {
          // Finalize message status if stream ended without explicit stop/error/stopped
          if (!messageFinalizedRef.current) {
            updateAgentMsg({
              content: accumulatedContentRef.current || "",
              status: "complete",
            });
          }
          setIsProcessing(false);
          setChatState("input");
          currentAgentMessageIdRef.current = null;
        },
      }
    );
  }, [
    message,
    isProcessing,
    currentSessionId,
    switchToSession,
    addMessage,
    updateMessage,
    execute,
    sessionPreferences,
    isToolAlwaysAllowed,
    setAlwaysAllowMemoryUpdates,
    createOperationHash,
    isOperationAllowed,
  ]);

  const stopProcessing = useCallback(() => {
    abort();
    // Also signal the backend to stop the agent loop
    if (currentSessionId) {
      fetch(`/api/agent/sessions/${currentSessionId}/stop`, {
        method: "POST",
      }).catch((err) => console.error("Failed to stop agent:", err));
    }

    // Explicitly reset state to ensure chat is ready for new input
    setIsProcessing(false);
    setChatState("input");
  }, [abort, currentSessionId]);

  /**
   * Handle tool approval - send approval to the backend and continue execution.
   */
  const handleToolApprove = useCallback(
    async (toolCallId: string, alwaysAllow: boolean, operationHash?: string) => {
      if (!currentSessionId) return;

      // Store approval preference if requested
      if (alwaysAllow && operationHash) {
        // Store this specific operation as approved
        setAlwaysAllowOperation(operationHash);
      }

      try {
        const response = await fetch(`/api/agent/sessions/${currentSessionId}/approval`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tool_call_id: toolCallId,
            approved: true,
          }),
        });

        if (!response.ok) {
          console.error("Failed to approve tool:", await response.text());
        }
      } catch (error) {
        console.error("Error approving tool:", error);
      }

      // Clear bottom approval UI
      setBottomApproval(null);
    },
    [currentSessionId, setAlwaysAllowOperation]
  );

  /**
   * Handle memory update approval - similar to tool approval but can set memory preference.
   */
  const handleMemoryUpdateApprove = useCallback(
    async (toolCallId: string, alwaysAllow: boolean) => {
      if (!currentSessionId) return;

      // Store preference if user opted to always allow
      if (alwaysAllow) {
        setAlwaysAllowMemoryUpdates(true);
      }

      try {
        const response = await fetch(`/api/agent/sessions/${currentSessionId}/approval`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tool_call_id: toolCallId,
            approved: true,
          }),
        });

        if (!response.ok) {
          console.error("Failed to approve memory update:", await response.text());
        }
      } catch (error) {
        console.error("Error approving memory update:", error);
      }

      setPendingMemoryUpdate(null);
    },
    [currentSessionId, setAlwaysAllowMemoryUpdates]
  );

  /**
   * Handle memory update denial.
   */
  const handleMemoryUpdateDeny = useCallback(
    async (toolCallId: string) => {
      if (!currentSessionId) return;

      try {
        const response = await fetch(`/api/agent/sessions/${currentSessionId}/approval`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tool_call_id: toolCallId,
            approved: false,
          }),
        });

        if (!response.ok) {
          console.error("Failed to deny memory update:", await response.text());
        }

        // Update the tool call status to show it was denied
        toolCallsRef.current = toolCallsRef.current.map((tc) =>
          tc.id === toolCallId
            ? { ...tc, status: "error" as const, error: "Memory update denied by user" }
            : tc
        );
        updateCurrentAgentMessage({
          toolCalls: toolCallsRef.current,
        });
      } catch (error) {
        console.error("Error denying memory update:", error);
      }

      setPendingMemoryUpdate(null);
    },
    [currentSessionId, updateCurrentAgentMessage]
  );

  /**
   * Close the memory update dialog without taking action.
   */
  const handleMemoryUpdateDialogClose = useCallback(() => {
    setPendingMemoryUpdate(null);
  }, []);

  /**
   * Handle tool denial - send denial to the backend and stop the tool.
   */
  const handleToolDeny = useCallback(
    async (toolCallId: string) => {
      if (!currentSessionId) return;

      try {
        const response = await fetch(`/api/agent/sessions/${currentSessionId}/approval`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tool_call_id: toolCallId,
            approved: false,
          }),
        });

        if (!response.ok) {
          console.error("Failed to deny tool:", await response.text());
        }

        // Update the tool call status to show it was denied
        toolCallsRef.current = toolCallsRef.current.map((tc) =>
          tc.id === toolCallId
            ? { ...tc, status: "error" as const, error: "Tool execution denied by user" }
            : tc
        );
        updateCurrentAgentMessage({
          toolCalls: toolCallsRef.current,
        });
      } catch (error) {
        console.error("Error denying tool:", error);
      }

      // Clear bottom approval UI
      setBottomApproval(null);
    },
    [currentSessionId, updateCurrentAgentMessage]
  );

  const handleFileUpload = useCallback((files: File[]) => {
    // TODO: Implement file upload for agent
    console.log("File upload for agent:", files);
  }, []);

  // No-op handlers for features not used in agent mode
  const noOp = useCallback(() => {}, []);

  return (
    <div
      className="flex-1 flex flex-row min-h-0 m-4 ml-0 overflow-hidden"
      data-testid="bud-agent-screen"
    >
      {/* Main content area */}
      <div
        className={cn(
          "flex-1 flex flex-col min-h-0 relative overflow-hidden rounded-xl",
          isDark && "bg-[#232526]"
        )}
      >
      {/* Grid Background */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          backgroundImage: isDark
            ? `linear-gradient(to right, rgba(255, 255, 255, 0.02) 1px, transparent 1px),
               linear-gradient(to bottom, rgba(255, 255, 255, 0.02) 1px, transparent 1px)`
            : `linear-gradient(to right, rgba(0, 0, 0, 0.02) 1px, transparent 1px),
               linear-gradient(to bottom, rgba(0, 0, 0, 0.02) 1px, transparent 1px)`,
          backgroundSize: '40px 40px'
        }}
      />

      {/* Backdrop overlay when approval is required */}
      {bottomApproval && (
        <div className="absolute inset-0 bg-black/50 z-40" />
      )}

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden default-scrollbar relative z-10" data-testid="agent-messages-container">
        {/* Top shadow fadeout */}
        {/* <div
          className="sticky left-0 right-0 h-8 pointer-events-none z-20 bg-gradient-to-b from-background via-background/70 to-transparent"
          style={{
            top: '60px',
          }}
        /> */}
        {isSessionLoading ? (
          <BudAgentSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4" data-testid="agent-intro">
            <div className="mb-6">
              <Logo size="large" />
            </div>
            <h2 className="text-2xl font-semibold mb-3">Bud Agent</h2>
            <p className="text-base max-w-lg mb-8 text-text-subtle">
              I can work autonomously on complex tasks. Just describe what you
              need and I&apos;ll handle it.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl w-full">
              {[
                "Research and summarize the latest AI trends",
                "Analyze my project and suggest improvements",
                "Write a technical blog post about...",
                "Create a data analysis report from...",
              ].map((suggestion, i) => (
                <button
                  key={i}
                  onClick={() => setMessage(suggestion)}
                  className="text-left px-4 py-3 rounded-lg border border-border transition-all hover:border-purple-500/50 hover:bg-background-emphasis"
                >
                  <span className="text-sm text-text-subtle">{suggestion}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto py-4 px-4 lg:px-5 w-[90%] max-w-message-max" data-testid="agent-messages-list">
            {messages.map((msg: AgentMessage) =>
              msg.role === "user" ? (
                <div
                  key={msg.id}
                  className="pt-5 pb-1 w-full flex"
                  data-testid="agent-message-user"
                >
                  <div
                    className="ml-auto max-w-[25rem] whitespace-break-spaces rounded-t-16 rounded-bl-16 py-2 px-3"
                    style={{
                      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.06)',
                    }}
                  >
                    <Text mainContentBody>{msg.content}</Text>
                  </div>
                </div>
              ) : (
                <div
                  key={msg.id}
                  className="py-5 relative flex"
                  data-testid="agent-message-agent"
                >
                  <div className="w-full max-w-message-max mx-auto">
                    <div className="flex items-start">
                      {selectedAssistant && (
                        <AgentIcon agent={selectedAssistant} />
                      )}
                      <div className="w-full ml-4">
                        <div className="max-w-content-max break-words">
                          {/* Initial loading dot before any packets arrive */}
                          {msg.status === "thinking" && !msg.content && (!msg.packets || msg.packets.length === 0) && (
                            <div className="py-1"><BlinkingDot /></div>
                          )}

                          {/* Status indicator - only for error/stopped states */}
                          {msg.status && msg.status !== "complete" && msg.status !== "thinking" && msg.status !== "streaming" && (
                            <span
                              data-testid="agent-message-status"
                              className={cn(
                                "text-xs mb-1 block",
                                msg.status === "error"
                                  ? "text-red-500"
                                  : msg.status === "stopped"
                                    ? "text-yellow-500"
                                    : "text-text-subtle"
                              )}
                            >
                              {msg.status === "error" && "error"}
                              {msg.status === "stopped" && "stopped"}
                            </span>
                          )}

                          {/* Tool calls display — packet-based rendering */}
                          {msg.packets && msg.packets.length > 0 && minimalChatState && msg.packets.some((p) => [PacketType.CUSTOM_TOOL_START, PacketType.SEARCH_TOOL_START, PacketType.FETCH_TOOL_START, PacketType.REASONING_START].includes(p.obj.type as PacketType)) ? (
                            <div
                              className="mb-3"
                              data-testid="agent-tool-calls"
                            >
                              <MultiToolRenderer
                                packetGroups={groupPacketsByInd(msg.packets)}
                                chatState={minimalChatState}
                                isComplete={msg.status === "complete" || msg.status === "error" || msg.status === "stopped"}
                                isFinalAnswerComing={msg.packets.some((p) => p.obj.type === "message_start")}
                                stopPacketSeen={msg.packets.some((p) => p.obj.type === "stop")}
                              />
                            </div>
                          ) : msg.toolCalls && msg.toolCalls.length > 0 ? (
                            /* Fallback for legacy sessions without packets */
                            <div
                              className="mb-3 space-y-2"
                              data-testid="agent-tool-calls"
                            >
                              {msg.toolCalls.map((toolCall) => (
                                <ToolCallDisplay
                                  key={toolCall.id}
                                  toolCall={toolCall}
                                />
                              ))}
                            </div>
                          ) : null}

                          {/* Markdown content with citation popovers */}
                          {msg.content && (() => {
                            const citationData = msg.packets && msg.packets.length > 0
                              ? extractCitationData(msg.packets)
                              : null;
                            const hasCitations = citationData && citationData.citations.length > 0;
                            const isSourcesExpanded = sidebarSourcesMsgId === msg.id;
                            return (
                              <>
                                <AgentMessageContent
                                  content={msg.content}
                                  docs={citationData?.docs}
                                  assistant={selectedAssistant}
                                />

                                {/* Copy button + Sources toggle on the same row */}
                                {msg.status === "complete" && (
                                  <div className="flex items-center gap-x-0.5 mt-1">
                                    <IconButton
                                      icon={
                                        copiedMessageId === msg.id
                                          ? SvgCheck
                                          : SvgCopy
                                      }
                                      onClick={() => {
                                        copyAll(msg.content);
                                        setCopiedMessageId(msg.id);
                                        if (copyTimeoutRef.current) {
                                          clearTimeout(copyTimeoutRef.current);
                                        }
                                        copyTimeoutRef.current = setTimeout(() => {
                                          setCopiedMessageId(null);
                                        }, 2000);
                                      }}
                                      tertiary
                                      tooltip={
                                        copiedMessageId === msg.id
                                          ? "Copied!"
                                          : "Copy"
                                      }
                                    />
                                    {hasCitations && (
                                      <CitedSourcesToggle
                                        citations={citationData.citations}
                                        documentMap={citationData.documentMap}
                                        nodeId={0}
                                        onToggle={() => {
                                          setSidebarSourcesMsgId(
                                            isSourcesExpanded ? null : msg.id
                                          );
                                        }}
                                      />
                                    )}
                                  </div>
                                )}

                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area - using the same ChatInputBar component */}
      <div className="p-4 flex justify-center relative z-50">
        <div className="w-full max-w-searchbar-max relative">
          {/* Approval UI - Positioned just above the chat input */}
          {bottomApproval && (
            <div className="absolute z-50 bottom-0 left-0 right-0 mb-2 border border-border rounded-lg shadow-lg p-5" style={{ backgroundColor: '#101010' }}>
              <InlineToolApproval
                toolName={bottomApproval.toolName}
                toolInput={bottomApproval.toolInput}
                toolCallId={bottomApproval.toolCallId}
                operationHash={bottomApproval.operationHash}
                onApprove={handleToolApprove}
                onDeny={handleToolDeny}
              />
            </div>
          )}

          {/* Chat Input */}
          {selectedAssistant ? (
            <ChatInputBar
              message={message}
              setMessage={setMessage}
              onSubmit={handleSubmit}
              stopGenerating={stopProcessing}
              chatState={chatState}
              llmManager={llmManager}
              filterManager={filterManager}
              selectedAssistant={selectedAssistant}
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
          ) : (
            <div className="text-sm text-text-subtle">
              Loading assistants...
            </div>
          )}
        </div>
      </div>

      {/* Memory Update Dialog */}
      {pendingMemoryUpdate && (
        <MemoryUpdateDialog
          isOpen={true}
          filePath={pendingMemoryUpdate.filePath}
          oldContent={pendingMemoryUpdate.oldContent}
          newContent={pendingMemoryUpdate.newContent}
          toolCallId={pendingMemoryUpdate.toolCallId}
          onApprove={handleMemoryUpdateApprove}
          onDeny={handleMemoryUpdateDeny}
          onClose={handleMemoryUpdateDialogClose}
        />
      )}
      </div>{/* End main content area */}

      {/* Sources Sidebar Drawer */}
      <div
        className={cn(
          "flex-shrink-0 overflow-hidden transition-all duration-300 ease-in-out",
          sidebarData ? "w-[25rem]" : "w-[0rem]"
        )}
      >
        <div className="h-full w-[25rem]">
          {sidebarData && (
            <AgentSourcesSidebar
              citationData={sidebarData}
              onClose={closeSidebar}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Right-side drawer showing cited sources, matching the chat session's DocumentResults sidebar.
 * Uses the same ChatDocumentDisplay component for individual document rendering.
 */
function AgentSourcesSidebar({
  citationData,
  onClose,
}: {
  citationData: {
    docs: OnyxDocument[];
    citations: StreamingCitation[];
    documentMap: Map<string, OnyxDocument>;
  };
  onClose: () => void;
}) {
  const { citations, documentMap } = citationData;
  const [, setPresentingDocument] = useState<OnyxDocument | null>(null);

  // Build the list of all documents from the map, deduped
  const allDocs = useMemo(() => {
    return removeDuplicateDocs(Array.from(documentMap.values()));
  }, [documentMap]);

  // Separate cited vs other documents
  const citedDocIds = useMemo(() => {
    const ids = new Set<string>();
    for (const c of citations) {
      ids.add(c.document_id);
    }
    return ids;
  }, [citations]);

  const citedDocs = useMemo(
    () => allDocs.filter((d) => citedDocIds.has(d.document_id)),
    [allDocs, citedDocIds]
  );
  const otherDocs = useMemo(
    () => allDocs.filter((d) => !citedDocIds.has(d.document_id)),
    [allDocs, citedDocIds]
  );

  return (
    <div
      id="onyx-chat-sidebar"
      className="overflow-y-auto h-full w-full"
    >
      <div className="h-full flex flex-col p-3 gap-6">
        {citedDocs.length > 0 && (
          <div>
            <div className="flex flex-row w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2 w-full px-3">
                <SvgSearchMenu className="w-[1.3rem] h-[1.3rem] stroke-text-03" />
                <Text headingH3 text03>
                  Cited Sources
                </Text>
              </div>
              <IconButton
                icon={SvgArrowWallRight}
                tertiary
                onClick={onClose}
                tooltip="Close Sidebar"
              />
            </div>
            <Separator className="border-b my-3 mx-2" />
            <div className="flex flex-col gap-1 items-center justify-center">
              {citedDocs.map((doc) => (
                <ChatDocumentDisplay
                  key={doc.document_id}
                  setPresentingDocument={setPresentingDocument as any}
                  closeSidebar={onClose}
                  modal={false}
                  document={doc}
                  isSelected={false}
                  handleSelect={() => {}}
                  hideSelection
                  tokenLimitReached={false}
                />
              ))}
            </div>
          </div>
        )}

        {otherDocs.length > 0 && (
          <div>
            <div className="flex flex-row w-full items-center justify-between gap-2">
              <div className="flex items-center gap-2 w-full px-3">
                <SvgSearchMenu className="w-[1.3rem] h-[1.3rem] stroke-text-03" />
                <Text headingH3 text03>
                  {citedDocs.length > 0 ? "More" : "Found Sources"}
                </Text>
              </div>
              {citedDocs.length === 0 && (
                <IconButton
                  icon={SvgArrowWallRight}
                  tertiary
                  onClick={onClose}
                  tooltip="Close Sidebar"
                />
              )}
            </div>
            <Separator className="border-b my-3 mx-2" />
            <div className="flex flex-col gap-1 items-center justify-center">
              {otherDocs.map((doc) => (
                <ChatDocumentDisplay
                  key={doc.document_id}
                  setPresentingDocument={setPresentingDocument as any}
                  closeSidebar={onClose}
                  modal={false}
                  document={doc}
                  isSelected={false}
                  handleSelect={() => {}}
                  hideSelection
                  tokenLimitReached={false}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Display component for a single tool call.
 */
function ToolCallDisplay({ toolCall }: { toolCall: ToolCallInfo }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusIcon = () => {
    switch (toolCall.status) {
      case "running":
        return (
          <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        );
      case "complete":
        return <FiCheck className="w-4 h-4 text-green-500" />;
      case "error":
        return <FiX className="w-4 h-4 text-red-500" />;
      case "approval_required":
        return <FiAlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <FiTool className="w-4 h-4 text-text-subtle" />;
    }
  };

  const getStatusText = () => {
    switch (toolCall.status) {
      case "running":
        return "Running...";
      case "complete":
        return "Complete";
      case "error":
        return "Error";
      case "approval_required":
        return "Approval Required";
      default:
        return "";
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid={`tool-call-${toolCall.name}`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid={`tool-call-header-${toolCall.name}`}
        className="w-full flex items-center gap-2 px-3 py-2 bg-background hover:bg-background-emphasis transition-colors text-left"
      >
        {getStatusIcon()}
        <span className="flex-1 text-xs font-medium truncate" data-testid="tool-call-name">
          {toolCall.name}
        </span>
        <span className="text-xs text-text-subtle" data-testid={`tool-call-status-${toolCall.status}`}>{getStatusText()}</span>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-border p-3 space-y-2 text-xs">
          {/* Input */}
          <div>
            <div className="font-medium text-text-subtle mb-1">Input:</div>
            <pre className="bg-background p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {/* Output */}
          {toolCall.output && (
            <div>
              <div className="font-medium text-text-subtle mb-1">Output:</div>
              <pre className="bg-background p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                {toolCall.output}
              </pre>
            </div>
          )}

          {/* Error */}
          {toolCall.error && (
            <div>
              <div className="font-medium text-red-500 mb-1">Error:</div>
              <pre className="bg-red-500/10 text-red-500 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
