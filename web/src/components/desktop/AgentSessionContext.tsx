"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";

export interface AgentMessage {
  id: string;
  role: "user" | "agent";
  content: string;
  timestamp: Date;
  status?: "thinking" | "executing" | "complete";
}

export interface AgentSession {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messages: AgentMessage[];
}

interface AgentSessionContextType {
  sessions: AgentSession[];
  currentSessionId: string | null;
  currentSession: AgentSession | null;
  createSession: (title?: string) => AgentSession;
  selectSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Omit<AgentMessage, "id" | "timestamp">) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
}

const AgentSessionContext = createContext<AgentSessionContextType | undefined>(undefined);

export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

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
    (sessionId: string, message: Omit<AgentMessage, "id" | "timestamp">) => {
      const newMessage: AgentMessage = {
        ...message,
        id: `msg-${Date.now()}`,
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

  return (
    <AgentSessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        currentSession,
        createSession,
        selectSession,
        deleteSession,
        addMessage,
        updateSessionTitle,
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
