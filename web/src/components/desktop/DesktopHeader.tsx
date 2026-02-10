"use client";

import { ModeSwitcher } from "./ModeSwitcher";
import { useDesktopMode } from "./DesktopModeContext";
import { useAppSidebarContext } from "@/refresh-components/contexts/AppSidebarContext";

/**
 * Desktop-only header that appears at the top of the app
 * Contains the mode switcher (Chat / BudAgent)
 * Full-width bar design similar to Playground header
 * Only renders when running in Tauri desktop environment
 * Spans the content area (accounting for sidebar width)
 */
export function DesktopHeader() {
  const { isDesktop, currentMode, setMode } = useDesktopMode();
  const { folded } = useAppSidebarContext();

  // Don't render anything if not in desktop mode
  if (!isDesktop) {
    return null;
  }

  // Sidebar widths from SidebarWrapper: folded = 3.5rem, unfolded = 15rem
  // Position the mode switcher bar to span the content area (to the right of sidebar)
  const sidebarWidth = folded ? "3.5rem" : "15rem";

  return (
    <div
      className="fixed top-0 z-[9999]"
      style={{
        left: sidebarWidth,
        right: 0,
      }}
    >
      <ModeSwitcher currentMode={currentMode} onModeChange={setMode} />
    </div>
  );
}
