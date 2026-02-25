"use client";

import { useDesktopMode } from "./DesktopModeContext";
import { BudAgentScreen } from "./BudAgentScreen";
import { AgentToolsView } from "./AgentToolsView";
import { AgentConfigView } from "./AgentConfigView";
import { CronJobsView } from "./CronJobsView";
import { ConnectorsView } from "./ConnectorsView";
import { InboxView } from "./InboxView";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

interface ModeRendererProps {
  children: React.ReactNode;
}

function DesktopContainer({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <div
      className={cn(
        "flex-1 flex flex-col min-h-0 relative rounded-xl m-4 ml-0 overflow-hidden",
        isDark ? "bg-[#232526]" : "bg-white border border-gray-200"
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
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative z-10 flex-1 flex flex-col min-h-0">
        {children}
      </div>
    </div>
  );
}

/**
 * Conditionally renders Chat or Agent mode based on current desktop mode
 * Only applies when running in desktop (Tauri) environment
 * In web mode, always shows the chat interface
 */
export function ModeRenderer({ children }: ModeRendererProps) {
  const { isDesktop, currentMode, agentView } = useDesktopMode();

  // If not desktop, show the normal chat interface
  if (!isDesktop) {
    return <>{children}</>;
  }

  // Desktop chat mode: wrap with rounded box styling
  if (currentMode === "chat") {
    return (
      <DesktopContainer>
        {children}
      </DesktopContainer>
    );
  }

  // In agent mode, route based on agentView
  // BudAgentScreen has its own container, other views use the shared one
  switch (agentView) {
    case "tools":
      return (
        <DesktopContainer>
          <AgentToolsView />
        </DesktopContainer>
      );
    case "configuration":
      return (
        <DesktopContainer>
          <AgentConfigView />
        </DesktopContainer>
      );
    case "cron":
      return (
        <DesktopContainer>
          <CronJobsView />
        </DesktopContainer>
      );
    case "connectors":
      return (
        <DesktopContainer>
          <ConnectorsView />
        </DesktopContainer>
      );
    case "inbox":
      return (
        <DesktopContainer>
          <InboxView />
        </DesktopContainer>
      );
    case "chat":
    default:
      return <BudAgentScreen />;
  }
}
