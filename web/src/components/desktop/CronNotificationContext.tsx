"use client";

import {
  createContext,
  useContext,
  ReactNode,
} from "react";
import { useIsDesktop } from "@/lib/desktop";
import { useCronPolling } from "@/lib/desktop/useCronPolling";
import type {
  CronNotification,
  CronToolRequest,
} from "@/lib/agent/types";

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
  const polling = useCronPolling(isDesktop);

  return (
    <CronNotificationContext.Provider value={polling}>
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
