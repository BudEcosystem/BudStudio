"use client";

import { useState, useEffect } from "react";

/**
 * Detect if the app is running in a Tauri desktop environment
 * Uses multiple detection methods for reliability with Tauri 2.0
 */
function detectTauri(): boolean {
  if (typeof window === "undefined") return false;

  // Method 1: Check for __TAURI__ global (withGlobalTauri: true)
  // @ts-ignore - __TAURI__ is injected by Tauri runtime
  if (window.__TAURI__ !== undefined) return true;

  // Method 2: Check for __TAURI_INTERNALS__ (Tauri 2.0)
  // @ts-ignore - __TAURI_INTERNALS__ is injected by Tauri runtime
  if (window.__TAURI_INTERNALS__ !== undefined) return true;

  // Method 3: Check for Tauri in the user agent
  if (navigator.userAgent.includes("Tauri")) return true;

  // Method 4: Check for desktop flag set by initial loading page
  if (localStorage.getItem("bud-is-desktop") === "true") return true;

  return false;
}

/**
 * Hook to detect if the app is running in a Tauri desktop environment
 * Returns true if running in Tauri, false otherwise
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const isTauri = detectTauri();
    setIsDesktop(isTauri);

    // If we detected Tauri, persist it for future checks
    if (isTauri) {
      localStorage.setItem("bud-is-desktop", "true");
    }
  }, []);

  return isDesktop;
}

/**
 * Synchronous check for desktop environment (for use outside of React components)
 * Note: This should only be called on the client side
 */
export function isDesktopApp(): boolean {
  return detectTauri();
}
