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
  uiSpec?: Record<string, unknown> | null;
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AgentMessage[];
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

interface BackendMessageSnapshot {
  id: string;
  role: string;
  content: string | null;
  tool_name: string | null;
  tool_input: Record<string, unknown> | null;
  tool_output: Record<string, unknown> | null;
  tool_error: string | null;
  ui_spec: Record<string, unknown> | null;
  created_at: string;
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
function convertBackendMessages(
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
      // Flush any pending agent message
      if (currentAgentMsg) {
        result.push(currentAgentMsg);
      }
      currentAgentMsg = {
        id: msg.id,
        role: "agent",
        content: msg.content || "",
        timestamp: new Date(msg.created_at),
        status: "complete",
        toolCalls: [],
        uiSpec: msg.ui_spec || undefined,
      };
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
      const data = (await resp.json()) as { messages: BackendMessageSnapshot[] };
      const messages = convertBackendMessages(data.messages);

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
