"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
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
}

interface AgentSessionContextType {
  sessions: AgentSession[];
  currentSessionId: string | null;
  currentSession: AgentSession | null;
  sessionPreferences: SessionPreferences;
  createSession: (title?: string) => AgentSession;
  selectSession: (sessionId: string) => void;
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
}

const AgentSessionContext = createContext<AgentSessionContextType | undefined>(undefined);

/**
 * Default session preferences.
 */
function createDefaultPreferences(): SessionPreferences {
  return {
    alwaysAllowTools: new Set<string>(),
    alwaysAllowMemoryUpdates: false,
  };
}

export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionPreferences, setSessionPreferences] = useState<SessionPreferences>(
    createDefaultPreferences()
  );

  const currentSession = sessions.find((s) => s.id === currentSessionId) || null;

  const createSession = useCallback((title?: string): AgentSession => {
    const newSession: AgentSession = {
      id: `agent-session-${Date.now()}`,
      title: title || "New Agent Task",
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
    };
    setSessions((prev) => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    return newSession;
  }, []);

  const selectSession = useCallback((sessionId: string) => {
    setCurrentSessionId(sessionId);
  }, []);

  const deleteSession = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (currentSessionId === sessionId) {
      setCurrentSessionId(null);
    }
  }, [currentSessionId]);

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
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, title, updatedAt: new Date() } : session
      )
    );
  }, []);

  /**
   * Mark a tool as always allowed for this session.
   */
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

  /**
   * Set whether memory updates are always allowed.
   */
  const setAlwaysAllowMemoryUpdates = useCallback((allow: boolean) => {
    setSessionPreferences((prev) => ({
      ...prev,
      alwaysAllowMemoryUpdates: allow,
    }));
  }, []);

  /**
   * Check if a tool is always allowed.
   */
  const isToolAlwaysAllowed = useCallback(
    (toolName: string) => {
      return sessionPreferences.alwaysAllowTools.has(toolName);
    },
    [sessionPreferences.alwaysAllowTools]
  );

  return (
    <AgentSessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        currentSession,
        sessionPreferences,
        createSession,
        selectSession,
        deleteSession,
        addMessage,
        updateMessage,
        updateSessionTitle,
        setAlwaysAllowTool,
        setAlwaysAllowMemoryUpdates,
        isToolAlwaysAllowed,
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
