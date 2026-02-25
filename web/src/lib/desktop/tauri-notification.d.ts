/**
 * Type declarations for @tauri-apps/plugin-notification.
 *
 * This module is dynamically imported at runtime and only available inside the
 * Tauri desktop shell.  The declaration prevents TS errors when the npm package
 * is not installed (e.g. in CI web-only builds).
 */
declare module "@tauri-apps/plugin-notification" {
  export function isPermissionGranted(): Promise<boolean>;
  export function requestPermission(): Promise<"granted" | "denied" | "default">;
  export function sendNotification(options: {
    title: string;
    body?: string;
    icon?: string;
  }): Promise<void>;
  export function setBadgeCount(count: number): Promise<void>;
}
