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
 * Styled as an iPhone Dynamic Island / notch-like floating pill
 * Supports both light and dark themes
 */
export function ModeSwitcher({
  currentMode,
  onModeChange,
  className,
}: ModeSwitcherProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const styles = {
    container: {
      background: isDark ? "#1c1c1e" : "#ffffff",
      boxShadow: isDark
        ? "0 0px 20px rgba(147, 51, 234, 0.5)"
        : "0 0px 20px rgba(147, 51, 234, 0.3), 0 2px 8px rgba(0,0,0,0.1)",
      border: isDark
        ? "1px solid rgba(192, 132, 252, 0.6)"
        : "1px solid rgba(147, 51, 234, 0.4)",
    },
    indicator: {
      background: isDark ? "rgba(255,255,255,0.12)" : "rgba(147, 51, 234, 0.15)",
    },
    activeText: isDark ? "#ffffff" : "#1c1c1e",
    inactiveText: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)",
    separator: isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.15)",
  };

  return (
    <div
      className={cn("relative flex items-center rounded-full px-1.5 py-1 gap-0.5", className)}
      style={styles.container}
      data-testid="mode-switcher"
    >
      {/* Sliding indicator */}
      <div
        className="absolute h-[calc(100%-8px)] rounded-full transition-all duration-300 ease-out"
        style={{
          background: styles.indicator.background,
          left: currentMode === "chat" ? "6px" : "72px",
          width: currentMode === "chat" ? "52px" : "44px",
        }}
      />

      <button
        onClick={() => onModeChange("chat")}
        className="relative z-10 px-4 py-1 rounded-full text-[13px] font-medium transition-all duration-300"
        style={{
          color: currentMode === "chat" ? styles.activeText : styles.inactiveText,
        }}
        data-testid="mode-switch-chat"
      >
        Chat
      </button>

      {/* Vertical separator */}
      <div
        className="relative z-10 w-px h-3.5 mx-1"
        style={{ background: styles.separator }}
      />

      <button
        onClick={() => onModeChange("agent")}
        className="relative z-10 px-4 py-1 rounded-full text-[13px] font-medium transition-all duration-300"
        style={{
          color: currentMode === "agent" ? styles.activeText : styles.inactiveText,
        }}
        data-testid="mode-switch-agent"
      >
        Bud
      </button>
    </div>
  );
}
