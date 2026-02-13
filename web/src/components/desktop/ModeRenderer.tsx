"use client";

import { useDesktopMode } from "./DesktopModeContext";
import { BudAgentScreen } from "./BudAgentScreen";
import { AgentToolsView } from "./AgentToolsView";
import { AgentConfigView } from "./AgentConfigView";
import { CronJobsView } from "./CronJobsView";
import { ConnectorsView } from "./ConnectorsView";

interface ModeRendererProps {
  children: React.ReactNode;
}

/**
 * Conditionally renders Chat or Agent mode based on current desktop mode
 * Only applies when running in desktop (Tauri) environment
 * In web mode, always shows the chat interface
 */
export function ModeRenderer({ children }: ModeRendererProps) {
  const { isDesktop, currentMode, agentView } = useDesktopMode();

  // If not desktop or in chat mode, show the normal chat interface
  if (!isDesktop || currentMode === "chat") {
    return <>{children}</>;
  }

  // In agent mode, route based on agentView
  switch (agentView) {
    case "tools":
      return <AgentToolsView />;
    case "configuration":
      return <AgentConfigView />;
    case "cron":
      return <CronJobsView />;
    case "connectors":
      return <ConnectorsView />;
    case "chat":
    default:
      return <BudAgentScreen />;
  }
}
