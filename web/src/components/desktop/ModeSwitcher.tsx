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

  const containerStyle = {
    background: isDark ? "#1c1c1e" : "#ffffff",
    boxShadow: isDark
      ? "0 0px 20px rgba(147, 51, 234, 0.5)"
      : "0 0px 20px rgba(147, 51, 234, 0.3), 0 2px 8px rgba(0,0,0,0.1)",
    border: isDark
      ? "1px solid rgba(192, 132, 252, 0.6)"
      : "1px solid rgba(147, 51, 234, 0.4)",
  };

  const activeText = isDark ? "#ffffff" : "#1c1c1e";
  const inactiveText = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.4)";
  const activeBg = isDark
    ? "rgba(255,255,255,0.12)"
    : "rgba(147, 51, 234, 0.15)";
  const separator = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.15)";

  return (
    <div
      className={cn(
        "relative flex items-center rounded-full px-1 py-1 gap-0.5",
        className
      )}
      style={containerStyle}
      data-testid="mode-switcher"
    >
      <ModeButton
        label="Chat"
        isActive={currentMode === "chat"}
        activeColor={activeText}
        inactiveColor={inactiveText}
        activeBg={activeBg}
        onClick={() => onModeChange("chat")}
        testId="mode-switch-chat"
      />

      {/* Vertical separator */}
      <div
        className="w-px h-3.5 shrink-0"
        style={{ background: separator }}
      />

      <ModeButton
        label="Bud"
        isActive={currentMode === "agent"}
        activeColor={activeText}
        inactiveColor={inactiveText}
        activeBg={activeBg}
        onClick={() => onModeChange("agent")}
        testId="mode-switch-agent"
      />
    </div>
  );
}

function ModeButton({
  label,
  isActive,
  activeColor,
  inactiveColor,
  activeBg,
  onClick,
  testId,
}: {
  label: string;
  isActive: boolean;
  activeColor: string;
  inactiveColor: string;
  activeBg: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-1 rounded-full text-[13px] font-medium transition-colors duration-200",
        !isActive && "hover:opacity-80"
      )}
      style={{
        color: isActive ? activeColor : inactiveColor,
        background: isActive ? activeBg : "transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = activeBg;
          e.currentTarget.style.color = activeColor;
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = inactiveColor;
        }
      }}
      data-testid={testId}
    >
      {label}
    </button>
  );
}
