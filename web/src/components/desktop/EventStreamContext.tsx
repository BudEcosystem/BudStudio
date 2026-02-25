"use client";

import React, {
  createContext,
  useContext,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import {
  useEventStream,
  type EventStreamEvent,
} from "@/lib/desktop/useEventStream";
import { useDesktopNotifications } from "@/lib/desktop/useDesktopNotifications";

type EventHandler = (event: EventStreamEvent) => void;

interface EventStreamContextType {
  connected: boolean;
  registerHandler: (eventType: string, handler: EventHandler) => void;
  unregisterHandler: (eventType: string, handler: EventHandler) => void;
}

const EventStreamContext = createContext<EventStreamContextType | undefined>(
  undefined
);

interface EventStreamProviderProps {
  children: ReactNode;
}

export function EventStreamProvider({ children }: EventStreamProviderProps) {
  const handlersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  const { notify } = useDesktopNotifications();

  const onEvent = useCallback(
    (event: EventStreamEvent) => {
      // Dispatch to registered handlers
      const handlers = handlersRef.current.get(event.event);
      if (handlers) {
        handlers.forEach((handler) => {
          try {
            handler(event);
          } catch (err) {
            console.error("Event handler error:", err);
          }
        });
      }

      // Fire desktop notifications
      switch (event.event) {
        case "inbox_message": {
          const senderName =
            (event.data.sender_name as string) || "Someone";
          notify("New message", `${senderName} sent you a message`);
          break;
        }
        case "session_message":
          notify("Agent update", "Your agent has an update for you");
          break;
        case "cron_status_change": {
          const status = event.data.status as string;
          if (status === "completed") {
            notify("Cron job completed", "A scheduled task has finished");
          } else if (status === "failed") {
            notify("Cron job failed", "A scheduled task has failed");
          } else if (status === "suspended") {
            notify(
              "Action required",
              "A scheduled task needs your approval"
            );
          }
          break;
        }
      }
    },
    [notify]
  );

  const { connected } = useEventStream({
    enabled: true,
    onEvent,
  });

  const registerHandler = useCallback(
    (eventType: string, handler: EventHandler) => {
      if (!handlersRef.current.has(eventType)) {
        handlersRef.current.set(eventType, new Set());
      }
      handlersRef.current.get(eventType)!.add(handler);
    },
    []
  );

  const unregisterHandler = useCallback(
    (eventType: string, handler: EventHandler) => {
      const handlers = handlersRef.current.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          handlersRef.current.delete(eventType);
        }
      }
    },
    []
  );

  return (
    <EventStreamContext.Provider
      value={{ connected, registerHandler, unregisterHandler }}
    >
      {children}
    </EventStreamContext.Provider>
  );
}

export function useEventStreamContext(): EventStreamContextType {
  const context = useContext(EventStreamContext);
  if (context === undefined) {
    return {
      connected: false,
      registerHandler: () => {},
      unregisterHandler: () => {},
    };
  }
  return context;
}
