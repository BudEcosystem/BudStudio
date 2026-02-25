"use client";

import { useEffect, useRef, useCallback, useState } from "react";

// Tauri IPC invoke function type
type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

/**
 * Hook for sending native desktop notifications via Tauri's notification plugin.
 *
 * Uses the Tauri IPC `invoke` API directly for sending notifications, because
 * the plugin's `sendNotification()` helper falls back to the Web Notification
 * API (`new window.Notification(...)`) which does NOT work in WKWebView on
 * macOS.  The IPC-based `plugin:notification|notify` command goes through the
 * Rust plugin and produces real native OS notifications.
 *
 * Only fires notifications when the window is NOT focused (except when
 * `force` is true).
 */
export function useDesktopNotifications() {
  const [permissionGranted, setPermissionGranted] = useState(false);
  const windowFocusedRef = useRef(true);
  const invokeRef = useRef<InvokeFn | null>(null);

  // Load the Tauri core invoke function dynamically
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const core = await import("@tauri-apps/api/core");
        if (cancelled) return;
        invokeRef.current = core.invoke;

        // Check / request permission via IPC
        // is_permission_granted returns Option<bool>: true, false, or null (unknown)
        const granted = await core.invoke<boolean | null>(
          "plugin:notification|is_permission_granted"
        );
        if (granted === true) {
          if (!cancelled) setPermissionGranted(true);
        } else {
          // null (unknown) or false (denied) — try requesting
          const result = await core.invoke<string>(
            "plugin:notification|request_permission"
          );
          if (!cancelled) {
            setPermissionGranted(result === "granted");
          }
        }
      } catch (err) {
        console.error("[notifications] Init failed:", err);
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
      if (!permissionGranted || !invokeRef.current) {
        return;
      }
      if (!options?.force && windowFocusedRef.current) {
        return;
      }

      invokeRef
        .current("plugin:notification|notify", {
          options: { title, body },
        })
        .catch((err) => {
          console.error("[notifications] IPC notify failed:", err);
        });
    },
    [permissionGranted]
  );

  /**
   * Update the macOS dock badge count.
   */
  const updateBadgeCount = useCallback((count: number) => {
    if (!invokeRef.current) return;

    invokeRef.current("plugin:notification|set_badge_count", { count }).catch(
      () => {
        // Ignore errors — not all platforms support badge count
      }
    );
  }, []);

  return { notify, updateBadgeCount, permissionGranted };
}
