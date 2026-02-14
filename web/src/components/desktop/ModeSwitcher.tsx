"use client";

import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

export type AppMode = "chat" | "agent";

interface ModeSwitcherProps {
  currentMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  className?: string;
}

/**
 * Desktop-only mode switcher between Chat and BudAgent modes
 * Styled to match the ThemeSwitcher in the sidebar
 */
export function ModeSwitcher({
  currentMode,
  onModeChange,
  className,
}: ModeSwitcherProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const isChat = currentMode === "chat";
  const activeText = "#ffffff";
  const inactiveText = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.7)";
  const activeBg = "#101416";

  return (
    <div
      className={cn(
        "flex items-center rounded-lg p-1 border bg-background-neutral-03 border-border-02",
        className
      )}
      data-testid="mode-switcher"
    >
      <button
        onClick={() => onModeChange("chat")}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 rounded-md",
          !isChat && "hover:opacity-70"
        )}
        style={{
          color: isChat ? activeText : inactiveText,
          background: isChat ? activeBg : "transparent",
        }}
        data-testid="mode-switch-chat"
      >
        Chat
      </button>
      <button
        onClick={() => onModeChange("agent")}
        className={cn(
          "flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-all duration-200 rounded-md",
          isChat && "hover:opacity-70"
        )}
        style={{
          color: !isChat ? activeText : inactiveText,
          background: !isChat ? activeBg : "transparent",
        }}
        data-testid="mode-switch-agent"
      >
        Bud
      </button>
    </div>
  );
}
