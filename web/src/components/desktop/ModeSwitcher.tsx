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
 * Styled as a top bar similar to Playground header
 * Supports both light and dark themes
 */
export function ModeSwitcher({
  currentMode,
  onModeChange,
  className,
}: ModeSwitcherProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const containerStyle = {
    backdropFilter: "blur(10px)",
  };

  const tabGroupBg = isDark ? "rgba(255, 255, 255, 0.05)" : "rgba(255, 255, 255, 1)";
  const tabGroupBorder = isDark ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)";
  const activeText = isDark ? "#ffffff" : "#ffffff";
  const inactiveText = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
  const activeBg = isDark ? "#7c3aed" : "#7c3aed";

  return (
    <div
      className={cn(
        "relative flex items-center justify-center p-3 bg-background-tint-02",
        className
      )}
      style={containerStyle}
      data-testid="mode-switcher"
    >
      <div
        className="flex items-center rounded-lg p-1 border"
        style={{ background: tabGroupBg, borderColor: tabGroupBorder }}
      >
        <ModeButton
          label="Chat"
          isActive={currentMode === "chat"}
          activeColor={activeText}
          inactiveColor={inactiveText}
          activeBg={activeBg}
          isDark={isDark}
          onClick={() => onModeChange("chat")}
          testId="mode-switch-chat"
        />

        <ModeButton
          label="Bud"
          isActive={currentMode === "agent"}
          activeColor={activeText}
          inactiveColor={inactiveText}
          activeBg={activeBg}
          isDark={isDark}
          onClick={() => onModeChange("agent")}
          testId="mode-switch-agent"
        />
      </div>
    </div>
  );
}

function ModeButton({
  label,
  isActive,
  activeColor,
  inactiveColor,
  activeBg,
  isDark,
  onClick,
  testId,
}: {
  label: string;
  isActive: boolean;
  activeColor: string;
  inactiveColor: string;
  activeBg: string;
  isDark: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-4 py-1 text-sm font-medium transition-all duration-200 rounded-md",
        !isActive && "hover:opacity-70"
      )}
      style={{
        color: isActive ? activeColor : inactiveColor,
        background: isActive ? activeBg : "transparent",
      }}
      data-testid={testId}
    >
      {label}
    </button>
  );
}
