"use client";

import {
  createContext,
  useContext,
  useEffect,
  ReactNode,
} from "react";
import { useIsDesktop } from "@/lib/desktop";
import { useCronPolling } from "@/lib/desktop/useCronPolling";
import { useEventStreamContext } from "./EventStreamContext";
import type {
  CronNotification,
  CronToolRequest,
} from "@/lib/agent/types";
import type { EventStreamEvent } from "@/lib/desktop/useEventStream";

interface CronNotificationContextType {
  notifications: CronNotification[];
  toolRequests: CronToolRequest[];
  unreadCount: number;
  dismissNotification: (executionId: string) => Promise<void>;
  dismissAllNotifications: () => Promise<void>;
  submitToolResult: (
    executionId: string,
    output?: string,
    error?: string
  ) => Promise<void>;
  isLoading: boolean;
}

const CronNotificationContext = createContext<
  CronNotificationContextType | undefined
>(undefined);

interface CronNotificationProviderProps {
  children: ReactNode;
}

export function CronNotificationProvider({
  children,
}: CronNotificationProviderProps) {
  const isDesktop = useIsDesktop();
  const { connected, registerHandler, unregisterHandler } =
    useEventStreamContext();
  const polling = useCronPolling(isDesktop, connected);

  // Register handler for real-time cron events
  useEffect(() => {
    const handleCronStatusChange = (_event: EventStreamEvent) => {
      polling.fetchPending();
    };

    registerHandler("cron_status_change", handleCronStatusChange);

    return () => {
      unregisterHandler("cron_status_change", handleCronStatusChange);
    };
  }, [registerHandler, unregisterHandler, polling]);

  return (
    <CronNotificationContext.Provider
      value={{
        notifications: polling.notifications,
        toolRequests: polling.toolRequests,
        unreadCount: polling.unreadCount,
        dismissNotification: polling.dismissNotification,
        dismissAllNotifications: polling.dismissAllNotifications,
        submitToolResult: polling.submitToolResult,
        isLoading: polling.isLoading,
      }}
    >
      {children}
    </CronNotificationContext.Provider>
  );
}

export function useCronNotifications(): CronNotificationContextType {
  const context = useContext(CronNotificationContext);
  if (context === undefined) {
    return {
      notifications: [],
      toolRequests: [],
      unreadCount: 0,
      dismissNotification: async () => {},
      dismissAllNotifications: async () => {},
      submitToolResult: async () => {},
      isLoading: false,
    };
  }
  return context;
}
