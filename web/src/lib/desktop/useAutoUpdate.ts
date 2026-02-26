"use client";

import { useState, useEffect, useCallback } from "react";
import { isDesktopApp } from "./hooks";

interface UpdateInfo {
  version: string;
  body: string | null;
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "up-to-date";

interface UseAutoUpdateReturn {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  error: string | null;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismiss: () => void;
}

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function useAutoUpdate(): UseAutoUpdateReturn {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (!isDesktopApp()) return;

    try {
      setStatus("checking");
      setError(null);

      const { invoke } = await import("@tauri-apps/api/core");
      const result = await invoke<UpdateInfo | null>("check_for_update");

      if (result) {
        setUpdateInfo(result);
        setStatus("available");
      } else {
        setStatus("up-to-date");
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus("error");
    }
  }, []);

  const installUpdate = useCallback(async () => {
    if (!isDesktopApp()) return;

    try {
      setStatus("downloading");
      setError(null);

      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("install_update");

      setStatus("ready");

      // Relaunch the app after a short delay
      const { relaunch } = await import("@tauri-apps/plugin-process");
      setTimeout(() => {
        relaunch();
      }, 1500);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setStatus("error");
    }
  }, []);

  const dismiss = useCallback(() => {
    setStatus("idle");
    setUpdateInfo(null);
    setError(null);
  }, []);

  // Check on mount and periodically
  useEffect(() => {
    if (!isDesktopApp()) return;

    // Delay initial check to let the app finish loading
    const initialTimeout = setTimeout(() => {
      checkForUpdate();
    }, 5000);

    const interval = setInterval(() => {
      checkForUpdate();
    }, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return {
    status,
    updateInfo,
    error,
    checkForUpdate,
    installUpdate,
    dismiss,
  };
}
