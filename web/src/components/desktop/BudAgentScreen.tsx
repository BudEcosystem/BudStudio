"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/logo/Logo";
import {
  useAgentSession,
  AgentMessage,
  ToolCallInfo,
} from "./AgentSessionContext";
import { ToolApprovalDialog } from "./ToolApprovalDialog";
import { MemoryUpdateDialog } from "./MemoryUpdateDialog";
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
import Text from "@/refresh-components/texts/Text";
import { BlinkingDot } from "@/app/chat/message/BlinkingDot";

/**
 * Interface for a pending tool approval request.
 */
interface PendingApproval {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

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
 * Renders agent message content with full markdown support (code blocks, GFM tables, math, etc.)
 */
function AgentMessageContent({ content }: { content: string }) {
  const { renderedContent } = useMarkdownRenderer(content, undefined, "text-base");
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
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatState, setChatState] = useState<ChatState>("input");
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [pendingMemoryUpdate, setPendingMemoryUpdate] = useState<PendingMemoryUpdate | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentAgentMessageIdRef = useRef<string | null>(null);
  const accumulatedContentRef = useRef<string>("");
  const toolCallsRef = useRef<ToolCallInfo[]>([]);

  const {
    currentSession,
    currentSessionId,
    switchToSession,
    addMessage,
    updateMessage,
    sessionPreferences,
    setAlwaysAllowTool,
    setAlwaysAllowMemoryUpdates,
    isToolAlwaysAllowed,
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

  const messages = currentSession?.messages || [];

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

          // Check if we should auto-approve based on preferences
          if (isMemory && sessionPreferences.alwaysAllowMemoryUpdates) {
            // Auto-approve memory updates
            handleToolApprove(toolCallId, false);
            return;
          }

          if (!isMemory && isToolAlwaysAllowed(toolName)) {
            // Auto-approve this tool
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
                  // Can't preview the edit, fall back to regular approval
                  setPendingApproval({ toolCallId, toolName, toolInput });
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
              // Fall back to regular approval dialog
            }
          }

          // Show the regular approval dialog
          setPendingApproval({
            toolCallId,
            toolName,
            toolInput,
          });
        },

        onComplete: (content) => {
          // Use the complete content from the event
          updateAgentMsg({
            content: content || accumulatedContentRef.current,
            status: "complete",
          });
        },

        onError: (error) => {
          updateAgentMsg({
            content:
              accumulatedContentRef.current ||
              `Error: ${error}`,
            status: "error",
          });
        },

        onStopped: () => {
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
  ]);

  const stopProcessing = useCallback(() => {
    abort();
    // Also signal the backend to stop the agent loop
    if (currentSessionId) {
      fetch(`/api/agent/sessions/${currentSessionId}/stop`, {
        method: "POST",
      }).catch((err) => console.error("Failed to stop agent:", err));
    }
  }, [abort, currentSessionId]);

  /**
   * Handle tool approval - send approval to the backend and continue execution.
   */
  const handleToolApprove = useCallback(
    async (toolCallId: string, alwaysAllow: boolean) => {
      if (!currentSessionId) return;

      // Find the pending approval to check if it's for a specific tool
      const approval = pendingApproval;
      if (approval && alwaysAllow) {
        // Check if this is a memory file
        const filePath = approval.toolInput.path as string | undefined;
        if (filePath && isMemoryFile(filePath)) {
          setAlwaysAllowMemoryUpdates(true);
        } else {
          setAlwaysAllowTool(approval.toolName);
        }
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
    },
    [currentSessionId, pendingApproval, setAlwaysAllowTool, setAlwaysAllowMemoryUpdates]
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
    },
    [currentSessionId, updateCurrentAgentMessage]
  );

  /**
   * Close the approval dialog without taking action.
   */
  const handleApprovalDialogClose = useCallback(() => {
    setPendingApproval(null);
  }, []);

  const handleFileUpload = useCallback((files: File[]) => {
    // TODO: Implement file upload for agent
    console.log("File upload for agent:", files);
  }, []);

  // No-op handlers for features not used in agent mode
  const noOp = useCallback(() => {}, []);

  return (
    <div className="flex-1 flex flex-col h-full" data-testid="bud-agent-screen">
      {/* Messages Area */}
      <div className="flex-1 overflow-auto" data-testid="agent-messages-container">
        {messages.length === 0 ? (
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
                  <div className="ml-auto max-w-[25rem] whitespace-break-spaces rounded-t-16 rounded-bl-16 bg-background-tint-02 py-2 px-3">
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
                          {/* Status indicator - only when not complete */}
                          {msg.status && msg.status !== "complete" && (
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
                              {msg.status === "thinking" && "thinking..."}
                              {msg.status === "streaming" && "responding..."}
                              {msg.status === "error" && "error"}
                              {msg.status === "stopped" && "stopped"}
                            </span>
                          )}

                          {/* Tool calls display */}
                          {msg.toolCalls && msg.toolCalls.length > 0 && (
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
                          )}

                          {/* Markdown content or thinking indicator */}
                          {msg.content ? (
                            <AgentMessageContent content={msg.content} />
                          ) : (
                            msg.status === "thinking" && (
                              <BlinkingDot addMargin />
                            )
                          )}

                          {/* Copy button when message is complete */}
                          {msg.status === "complete" && msg.content && (
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
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            )}

            {/* Thinking indicator when processing but no content yet */}
            {isProcessing &&
              (!currentAgentMessageIdRef.current ||
                !accumulatedContentRef.current) && (
                <div className="py-5 relative flex">
                  <div className="w-full max-w-message-max mx-auto">
                    <div className="flex items-start">
                      {selectedAssistant && (
                        <AgentIcon agent={selectedAssistant} />
                      )}
                      <div className="ml-4">
                        <BlinkingDot addMargin />
                      </div>
                    </div>
                  </div>
                </div>
              )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Stop button - shown when processing */}
      {isProcessing && (
        <div className="flex justify-center py-2">
          <button
            onClick={stopProcessing}
            data-testid="agent-stop-button"
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
          >
            <span className="w-4 h-4 bg-white rounded-sm" />
            Stop Agent
          </button>
        </div>
      )}

      {/* Input Area - using the same ChatInputBar component */}
      <div className="p-4 flex justify-center">
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

      {/* Tool Approval Dialog */}
      {pendingApproval && (
        <ToolApprovalDialog
          isOpen={true}
          toolName={pendingApproval.toolName}
          toolInput={pendingApproval.toolInput}
          toolCallId={pendingApproval.toolCallId}
          onApprove={handleToolApprove}
          onDeny={handleToolDeny}
          onClose={handleApprovalDialogClose}
        />
      )}

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
