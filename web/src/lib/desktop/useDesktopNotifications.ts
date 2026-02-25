"use client";

import { useEffect, useRef, useCallback, useState } from "react";

/**
 * Hook for sending native desktop notifications via Tauri's notification plugin.
 *
 * Dynamically imports `@tauri-apps/plugin-notification` to avoid breaking web
 * builds.  Only fires notifications when the window is NOT focused (except
 * when `force` is true).
 */
export function useDesktopNotifications() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const windowFocusedRef = useRef(true);
  const pluginRef = useRef<typeof import("@tauri-apps/plugin-notification") | null>(null);

  // Load the Tauri notification plugin dynamically
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const mod = await import("@tauri-apps/plugin-notification");
        if (cancelled) return;
        pluginRef.current = mod;

        // Request permission
        let perm = await mod.isPermissionGranted();
        if (!perm) {
          const result = await mod.requestPermission();
          perm = result === "granted";
        }
        if (!cancelled) {
          setPermissionGranted(perm);
        }
      } catch {
        // Not running in Tauri — ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Track window focus
  useEffect(() => {
    const onFocus = () => {
      windowFocusedRef.current = true;
    };
    const onBlur = () => {
      windowFocusedRef.current = false;
    };

    // Set initial state
    windowFocusedRef.current = document.hasFocus();

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  /**
   * Show a native notification. By default only fires when the app is
   * unfocused. Pass `force: true` to always show.
   */
  const notify = useCallback(
    (title: string, body: string, options?: { force?: boolean }) => {
      if (!permissionGranted || !pluginRef.current) return;
      if (!options?.force && windowFocusedRef.current) return;

      pluginRef.current
        .sendNotification({ title, body })
        .catch(() => {
          // Ignore notification errors
        });
    },
    [permissionGranted]
  );

  /**
   * Update the macOS dock badge count.
   */
  const updateBadgeCount = useCallback((count: number) => {
    if (!pluginRef.current) return;

    try {
      // setBadgeCount is available in tauri-plugin-notification >= 2.0
      const mod = pluginRef.current as Record<string, unknown>;
      if (typeof mod.setBadgeCount === "function") {
        (mod.setBadgeCount as (count: number) => Promise<void>)(count).catch(
          () => {}
        );
      }
    } catch {
      // Ignore
    }
  }, []);

  return { notify, updateBadgeCount, permissionGranted };
}
