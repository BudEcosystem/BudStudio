/**
 * Electron integration utilities for detecting and interacting with
 * the desktop app environment.
 */

export interface ElectronDialogAPI {
  selectDirectory: () => Promise<string | null>;
  selectFile: (
    filters?: Array<{ name: string; extensions: string[] }>
  ) => Promise<string | null>;
  showMessage: (options: {
    type: string;
    message: string;
    detail?: string;
  }) => Promise<{ response: number }>;
}

export interface ElectronShellAPI {
  openExternal: (url: string) => Promise<{ success: boolean }>;
  showItemInFolder: (path: string) => Promise<{ success: boolean }>;
}

export interface ElectronAppAPI {
  getVersion: () => Promise<string>;
  getPath: (name: string) => Promise<string>;
}

export interface ElectronAPI {
  platform: string;
  isElectron: boolean;
  dialog: ElectronDialogAPI;
  shell: ElectronShellAPI;
  app: ElectronAppAPI;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

/**
 * Check if the app is running inside Electron desktop app.
 * Safe to call on server-side (returns false).
 */
export function isElectron(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return !!window.electronAPI?.isElectron;
}

/**
 * Get the Electron API if available.
 * Returns null if not running in Electron or on server-side.
 */
export function getElectronAPI(): ElectronAPI | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (window.electronAPI?.isElectron) {
    return window.electronAPI;
  }
  return null;
}

/**
 * Get the current platform if running in Electron.
 * Returns null if not running in Electron.
 */
export function getElectronPlatform(): string | null {
  const api = getElectronAPI();
  return api?.platform ?? null;
}

/**
 * Open a native directory picker dialog.
 * Only works in Electron; returns null in browser.
 */
export async function selectDirectory(): Promise<string | null> {
  const api = getElectronAPI();
  if (!api) {
    console.warn("selectDirectory called outside of Electron context");
    return null;
  }
  return api.dialog.selectDirectory();
}

/**
 * Open a native file picker dialog.
 * Only works in Electron; returns null in browser.
 */
export async function selectFile(
  filters?: Array<{ name: string; extensions: string[] }>
): Promise<string | null> {
  const api = getElectronAPI();
  if (!api) {
    console.warn("selectFile called outside of Electron context");
    return null;
  }
  return api.dialog.selectFile(filters);
}

/**
 * Open a URL in the default browser.
 * In Electron, uses shell.openExternal.
 * In browser, falls back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  const api = getElectronAPI();
  if (api) {
    await api.shell.openExternal(url);
  } else if (typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * Show a file or folder in the system file manager.
 * Only works in Electron.
 */
export async function showItemInFolder(path: string): Promise<void> {
  const api = getElectronAPI();
  if (!api) {
    console.warn("showItemInFolder called outside of Electron context");
    return;
  }
  await api.shell.showItemInFolder(path);
}
