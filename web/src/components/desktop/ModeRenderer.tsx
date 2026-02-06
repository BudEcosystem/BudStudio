"use client";

import { useDesktopMode } from "./DesktopModeContext";
import { BudAgentScreen } from "./BudAgentScreen";

interface ModeRendererProps {
  children: React.ReactNode;
}

/**
 * Conditionally renders Chat or Agent mode based on current desktop mode
 * Only applies when running in desktop (Tauri) environment
 * In web mode, always shows the chat interface
 */
export function ModeRenderer({ children }: ModeRendererProps) {
  const { isDesktop, currentMode } = useDesktopMode();

  // If not desktop or in chat mode, show the normal chat interface
  if (!isDesktop || currentMode === "chat") {
    return <>{children}</>;
  }

  // In agent mode, show the Bud Agent interface
  return <BudAgentScreen />;
}
