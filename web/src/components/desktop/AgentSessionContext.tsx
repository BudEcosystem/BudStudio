"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  ReactNode,
} from "react";
import type { Packet } from "@/app/chat/services/streamingModels";
import { useEventStreamContext } from "./EventStreamContext";
import type { EventStreamEvent } from "@/lib/desktop/useEventStream";

/**
 * Tool call information for display in the UI.
 */
export interface ToolCallInfo {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  status: "running" | "complete" | "error" | "approval_required";
}

export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  status?: "thinking" | "streaming" | "complete" | "error" | "stopped";
  toolCalls?: ToolCallInfo[];
  /** Packet data for unified rendering (streaming + history). */
  packets?: Packet[];
  /** Accumulated reasoning/thinking content from the model. */
  thinkingContent?: string;
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AgentMessage[];
  /** Type of session: ROOT, SUB_ONE_SHOT, SUB_PERSISTENT, etc. */
  session_type?: string;
  /** If this is a sub-session, the ID of the parent session. */
  parent_session_id?: string;
  /** Human-readable description of the task this session is working on. */
  task_description?: string;
}

/**
 * Session preferences for tool approvals and memory updates.
 */
export interface SessionPreferences {
  /** Tools that the user has chosen to always allow */
  alwaysAllowTools: Set<string>;
  /** Whether to always allow memory file updates */
  alwaysAllowMemoryUpdates: boolean;
  /** Specific operations (tool+params hash) that user has chosen to always allow */
  approvedOperations: Set<string>;
}

interface AgentSessionContextType {
  sessions: AgentSession[];
  currentSessionId: string | null;
  currentSession: AgentSession | null;
  sessionPreferences: SessionPreferences;
  isLoading: boolean;
  createSession: (idOrTitle?: string) => AgentSession;
  clearCurrentSession: () => void;
  selectSession: (sessionId: string) => void;
  switchToSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Omit<AgentMessage, "id" | "timestamp">) => AgentMessage;
  updateMessage: (
    sessionId: string,
    messageId: string,
    updates: Partial<Omit<AgentMessage, "id" | "timestamp" | "role">>
  ) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  setAlwaysAllowTool: (toolName: string) => void;
  setAlwaysAllowMemoryUpdates: (allow: boolean) => void;
  isToolAlwaysAllowed: (toolName: string) => boolean;
  setAlwaysAllowOperation: (operationHash: string) => void;
  isOperationAllowed: (operationHash: string) => boolean;
  createOperationHash: (toolName: string, toolInput: Record<string, unknown>) => string;
  reloadSessionMessages: (sessionId: string) => void;
}

const AgentSessionContext = createContext<AgentSessionContextType | undefined>(undefined);

/**
 * Backend API response types.
 */
interface BackendSessionSnapshot {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface BackendMessageSnapshot {
  id: string;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  tool_error: string | null;
  tool_call_id: string | null;
  step_number: number | null;
  thinking_content: string | null;
  ui_spec: Record<string, unknown> | null;
  created_at: string;
}

export interface BackendPacketResponse {
  ind: number;
  obj: Record<string, unknown>;
}

export interface BackendHistoryResponse {
  messages: BackendMessageSnapshot[];
  packets: BackendPacketResponse[][];
}

/**
 * Create a stable hash for an operation (tool + params).
 * Used to track operation-specific approvals.
 */
function createOperationHashFn(
  toolName: string,
  toolInput: Record<string, unknown>
): string {
  // Create deterministic string representation of the input
  const stableStringify = (obj: unknown): string => {
    if (obj === null) return "null";
    if (typeof obj !== "object") return String(obj);
    if (Array.isArray(obj)) {
      return `[${obj.map(stableStringify).join(",")}]`;
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const pairs = keys.map((k) => `${k}:${stableStringify((obj as Record<string, unknown>)[k])}`);
    return `{${pairs.join(",")}}`;
  };

  return `${toolName}::${stableStringify(toolInput)}`;
}

/**
 * Default session preferences.
 */
function createDefaultPreferences(): SessionPreferences {
  return {
    alwaysAllowTools: new Set<string>(),
    alwaysAllowMemoryUpdates: false,
    approvedOperations: new Set<string>(),
  };
}

/**
 * Convert backend messages into frontend AgentMessage format.
 *
 * Backend messages have separate rows for user, assistant, and tool messages.
 * Frontend groups tool calls into the agent message's toolCalls array.
 */
export function convertBackendMessages(
  backendMessages: BackendMessageSnapshot[]
): AgentMessage[] {
  const result: AgentMessage[] = [];
  let currentAgentMsg: AgentMessage | null = null;

  for (const msg of backendMessages) {
    if (msg.role === "user") {
      // Flush any pending agent message
      if (currentAgentMsg) {
        result.push(currentAgentMsg);
        currentAgentMsg = null;
      }
      result.push({
        id: msg.id,
        role: "user",
        content: msg.content || "",
        timestamp: new Date(msg.created_at),
        status: "complete",
      });
    } else if (msg.role === "assistant") {
      if (!currentAgentMsg) {
        // First assistant in this turn — create agent message
        currentAgentMsg = {
          id: msg.id,
          role: "agent",
          content: msg.content || "",
          timestamp: new Date(msg.created_at),
          status: "complete",
          toolCalls: [],
        };
      } else if (msg.content) {
        // Check if this is an injected message (sub-session result, cron
        // notification, etc.) vs a continuation of the current LLM turn.
        // Injected messages have no step_number. Turn messages do.
        const isInjected = msg.step_number == null && currentAgentMsg.content;

        if (isInjected) {
          // Separate message — flush current and start new.
          result.push(currentAgentMsg);
          currentAgentMsg = {
            id: msg.id,
            role: "agent",
            content: msg.content,
            timestamp: new Date(msg.created_at),
            status: "complete",
            toolCalls: [],
          };
        } else {
          // Same turn — update content. Keeps tool calls + packets together.
          currentAgentMsg.content = msg.content;
        }
      }
      // else: intermediate thinking-only assistant — skip,
      // keep accumulating tools into the existing currentAgentMsg
    } else if (msg.role === "tool") {
      // Attach to current agent message as a tool call
      if (currentAgentMsg) {
        const toolCall: ToolCallInfo = {
          id: msg.id,
          name: msg.tool_name || "unknown",
          input: msg.tool_input || {},
          output: msg.tool_output
            ? typeof msg.tool_output === "string"
              ? msg.tool_output
              : JSON.stringify(msg.tool_output)
            : undefined,
          error: msg.tool_error || undefined,
          status: msg.tool_error ? "error" : "complete",
        };
        currentAgentMsg.toolCalls = [
          ...(currentAgentMsg.toolCalls || []),
          toolCall,
        ];
      }
    }
  }

  // Flush any remaining agent message
  if (currentAgentMsg) {
    result.push(currentAgentMsg);
  }

  return result;
}

export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sessionPreferences, setSessionPreferences] = useState<SessionPreferences>(
    createDefaultPreferences()
  );
  // Track which sessions have had their messages loaded from the backend
  const loadedSessionsRef = useRef<Set<string>>(new Set());
  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  // ──────────────────────────────────────────────────────────────────────────
  // Hydrate single active session from backend on mount
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function fetchActiveSession(): Promise<void> {
      try {
        const resp = await fetch("/api/agent/active-session");
        if (!resp.ok) {
          console.error("Failed to fetch active session:", resp.status);
          return;
        }
        const s = (await resp.json()) as BackendSessionSnapshot;

        if (cancelled) return;

        const session: AgentSession = {
          id: s.id,
          title: s.title || "Agent Task",
          createdAt: new Date(s.created_at),
          updatedAt: new Date(s.updated_at),
          messages: [],
        };

        setSessions([session]);
        setCurrentSessionId(session.id);
        // Load messages for the active session and wait for completion
        await loadSessionMessages(session.id);
      } catch (err) {
        console.error("Error fetching active session:", err);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchActiveSession();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ──────────────────────────────────────────────────────────────────────────
  // Lazy-load message history when a session is selected
  // ──────────────────────────────────────────────────────────────────────────
  const loadSessionMessages = useCallback(async (sessionId: string): Promise<void> => {
    // Don't re-fetch if we already loaded this session's messages
    if (loadedSessionsRef.current.has(sessionId)) return;

    try {
      const resp = await fetch(`/api/agent/sessions/${sessionId}/history`);
      if (!resp.ok) {
        console.error("Failed to fetch session history:", resp.status);
        return;
      }
      const data = (await resp.json()) as BackendHistoryResponse;
      const messages = convertBackendMessages(data.messages);

      // Map packet turns to agent messages.
      // Packet turns are grouped by user-message boundaries. Agent messages
      // may be split further (e.g. sub-session results injected between turns).
      // Assign each packet turn to the first agent message that has tool calls.
      if (data.packets && data.packets.length > 0) {
        const agentMsgs = messages.filter((m) => m.role === "agent");
        let agentIdx = 0;
        for (let turnIdx = 0; turnIdx < data.packets.length; turnIdx++) {
          const packetTurn = data.packets[turnIdx];
          if (!packetTurn || packetTurn.length === 0) continue;

          // Skip agent messages with no toolCalls and no content
          // (empty placeholders) to find the right one for this turn
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

      loadedSessionsRef.current.add(sessionId);

      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, messages } : s
        )
      );
    } catch (err) {
      console.error("Error fetching session messages:", err);
    }
  }, []);

  /** Force-reload messages for a session, bypassing the loaded cache. */
  const reloadSessionMessages = useCallback(
    (sessionId: string) => {
      loadedSessionsRef.current.delete(sessionId);
      loadSessionMessages(sessionId);
    },
    [loadSessionMessages]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Event stream handler registration (moved after switchToSession definition)
  // ──────────────────────────────────────────────────────────────────────────
  const { registerHandler, unregisterHandler } = useEventStreamContext();

  // ──────────────────────────────────────────────────────────────────────────
  // Session CRUD
  // ──────────────────────────────────────────────────────────────────────────

  const createSession = useCallback((idOrTitle?: string): AgentSession => {
    // If the argument looks like a UUID, treat it as the session ID
    // (created by the backend). Otherwise treat it as a title.
    const isUuid =
      idOrTitle != null &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrTitle
      );
    const newSession: AgentSession = {
      id: isUuid ? idOrTitle : `agent-session-${Date.now()}`,
      title: isUuid ? "New Agent Task" : idOrTitle || "New Agent Task",
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
    };

    // Mark as already loaded so we don't fetch empty history
    loadedSessionsRef.current.add(newSession.id);

    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);

    // Reset session preferences for new session
    setSessionPreferences(createDefaultPreferences());

    return newSession;
  }, []);

  const clearCurrentSession = useCallback(() => {
    setCurrentSessionId(null);
    setSessionPreferences(createDefaultPreferences());
  }, []);

  const selectSession = useCallback(
    (sessionId: string) => {
      setCurrentSessionId(sessionId);
      // Reset preferences when switching sessions
      setSessionPreferences(createDefaultPreferences());
      // Load messages if not already loaded
      loadSessionMessages(sessionId);
    },
    [loadSessionMessages]
  );

  /**
   * Switch to a new session (e.g., after compaction).
   * Adds a placeholder session entry if it doesn't already exist and selects it.
   */
  const switchToSession = useCallback(
    (sessionId: string) => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === sessionId);
        if (exists) return prev;
        const placeholder: AgentSession = {
          id: sessionId,
          title: "Agent Task",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
        };
        // Mark as loaded so we don't fetch (it's brand new)
        loadedSessionsRef.current.add(sessionId);
        return [placeholder, ...prev];
      });
      setCurrentSessionId(sessionId);
    },
    []
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Real-time session message events via SSE
  // (placed after switchToSession so the const is initialised when referenced)
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handleSessionMessage = (event: EventStreamEvent) => {
      const sessionId = event.data.session_id as string | undefined;
      if (!sessionId) return;

      if (sessionId !== currentSessionId) {
        // Different session received a proactive message — switch to it
        switchToSession(sessionId);
      }

      // Clear cache (after switchToSession which may re-add it) then re-fetch
      loadedSessionsRef.current.delete(sessionId);
      loadSessionMessages(sessionId);
    };

    registerHandler("session_message", handleSessionMessage);
    return () => {
      unregisterHandler("session_message", handleSessionMessage);
    };
  }, [registerHandler, unregisterHandler, currentSessionId, loadSessionMessages, switchToSession]);

  const deleteSession = useCallback(
    (sessionId: string) => {
      // Remove from local state immediately
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      loadedSessionsRef.current.delete(sessionId);
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
      }

      // Delete from backend (fire-and-forget)
      fetch(`/api/agent/sessions/${sessionId}`, { method: "DELETE" }).catch(
        (err) => console.error("Failed to delete session on backend:", err)
      );
    },
    [currentSessionId]
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Message management
  // ──────────────────────────────────────────────────────────────────────────

  const addMessage = useCallback(
    (sessionId: string, message: Omit<AgentMessage, "id" | "timestamp">): AgentMessage => {
      const newMessage: AgentMessage = {
        ...message,
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
      };
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) return session;
          // Update title from first user message if it's the default
          const isFirstUserMessage =
            message.role === "user" && session.messages.length === 0;
          return {
            ...session,
            title: isFirstUserMessage
              ? message.content.slice(0, 50) + (message.content.length > 50 ? "..." : "")
              : session.title,
            updatedAt: new Date(),
            messages: [...session.messages, newMessage],
          };
        })
      );
      return newMessage;
    },
    []
  );

  const updateMessage = useCallback(
    (
      sessionId: string,
      messageId: string,
      updates: Partial<Omit<AgentMessage, "id" | "timestamp" | "role">>
    ) => {
      setSessions((prev) =>
        prev.map((session) => {
          if (session.id !== sessionId) return session;
          return {
            ...session,
            updatedAt: new Date(),
            messages: session.messages.map((msg) =>
              msg.id === messageId ? { ...msg, ...updates } : msg
            ),
          };
        })
      );
    },
    []
  );

  const updateSessionTitle = useCallback((sessionId: string, title: string) => {
    // Update local state
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, title, updatedAt: new Date() } : session
      )
    );

    // Sync to backend (fire-and-forget)
    fetch(`/api/agent/sessions/${sessionId}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }).catch((err) =>
      console.error("Failed to update session title on backend:", err)
    );
  }, []);

  // ──────────────────────────────────────────────────────────────────────────
  // Preferences
  // ──────────────────────────────────────────────────────────────────────────

  const setAlwaysAllowTool = useCallback((toolName: string) => {
    setSessionPreferences((prev) => {
      const newSet = new Set(prev.alwaysAllowTools);
      newSet.add(toolName);
      return {
        ...prev,
        alwaysAllowTools: newSet,
      };
    });
  }, []);

  const setAlwaysAllowMemoryUpdates = useCallback((allow: boolean) => {
    setSessionPreferences((prev) => ({
      ...prev,
      alwaysAllowMemoryUpdates: allow,
    }));
  }, []);

  const isToolAlwaysAllowed = useCallback(
    (toolName: string) => {
      return sessionPreferences.alwaysAllowTools.has(toolName);
    },
    [sessionPreferences.alwaysAllowTools]
  );

  const setAlwaysAllowOperation = useCallback((operationHash: string) => {
    setSessionPreferences((prev) => {
      const newSet = new Set(prev.approvedOperations);
      newSet.add(operationHash);
      return {
        ...prev,
        approvedOperations: newSet,
      };
    });
  }, []);

  const isOperationAllowed = useCallback(
    (operationHash: string) => {
      return sessionPreferences.approvedOperations.has(operationHash);
    },
    [sessionPreferences.approvedOperations]
  );

  const createOperationHash = useCallback(
    (toolName: string, toolInput: Record<string, unknown>) => {
      return createOperationHashFn(toolName, toolInput);
    },
    []
  );

  return (
    <AgentSessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        currentSession,
        sessionPreferences,
        isLoading,
        createSession,
        clearCurrentSession,
        selectSession,
        switchToSession,
        deleteSession,
        addMessage,
        updateMessage,
        updateSessionTitle,
        setAlwaysAllowTool,
        setAlwaysAllowMemoryUpdates,
        isToolAlwaysAllowed,
        setAlwaysAllowOperation,
        isOperationAllowed,
        createOperationHash,
        reloadSessionMessages,
      }}
    >
      {children}
    </AgentSessionContext.Provider>
  );
}

export function useAgentSession() {
  const context = useContext(AgentSessionContext);
  if (context === undefined) {
    throw new Error("useAgentSession must be used within an AgentSessionProvider");
  }
  return context;
}
