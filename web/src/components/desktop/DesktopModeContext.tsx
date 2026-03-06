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

export type AppMode = "chat" | "agent";
export type AgentView = "chat" | "tools" | "configuration" | "cron" | "connectors" | "inbox" | "skills";

interface DesktopModeContextType {
  isDesktop: boolean;
  currentMode: AppMode;
  setMode: (mode: AppMode) => void;
  agentView: AgentView;
  setAgentView: (view: AgentView) => void;
}

const DesktopModeContext = createContext<DesktopModeContextType | undefined>(
  undefined
);

interface DesktopModeProviderProps {
  children: ReactNode;
}

export function DesktopModeProvider({ children }: DesktopModeProviderProps) {
  const isDesktop = useIsDesktop();
  const [currentMode, setCurrentMode] = useState<AppMode>("chat");
  const [agentView, setAgentView] = useState<AgentView>("chat");

  const setMode = useCallback((mode: AppMode) => {
    setCurrentMode(mode);
    setAgentView("chat");
    // Persist to localStorage for desktop app
    if (typeof window !== "undefined") {
      localStorage.setItem("bud-desktop-mode", mode);
    }
  }, []);

  // Load persisted mode on mount
  useEffect(() => {
    const savedMode = localStorage.getItem("bud-desktop-mode") as AppMode;
    if (savedMode && (savedMode === "chat" || savedMode === "agent")) {
      setCurrentMode(savedMode);
    }
  }, []);

  return (
    <DesktopModeContext.Provider
      value={{ isDesktop, currentMode, setMode, agentView, setAgentView }}
    >
      {children}
    </DesktopModeContext.Provider>
  );
}

export function useDesktopMode(): DesktopModeContextType {
  const context = useContext(DesktopModeContext);
  if (context === undefined) {
    // Return default values if used outside provider (e.g., in non-desktop context)
    return {
      isDesktop: false,
      currentMode: "chat",
      setMode: () => {},
      agentView: "chat",
      setAgentView: () => {},
    };
  }
  return context;
}
