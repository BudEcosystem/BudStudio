"use client";

import { useRef, useCallback, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import type { UserQuestionItem } from "@/app/chat/services/streamingModels";

// ── Callback interface (mirrors AgentEventCallbacks from useAgentSSE) ──

export interface AgentSocketCallbacks {
  onThinking?: () => void;
  onText?: (content: string) => void;
  onToolStart?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolCallId: string
  ) => void;
  onToolResult?: (
    toolName: string,
    toolOutput: string,
    toolError: string | undefined,
    toolCallId: string
  ) => void;
  onApprovalRequired?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolCallId: string,
    gatewayId: string | null
  ) => void;
  onComplete?: (content: string) => void;
  onError?: (error: string) => void;
  onStopped?: () => void;
  onDone?: () => void;
  onSessionCompacted?: (newSessionId: string, summary: string) => void;
  onSessionUpdated?: (
    sessionId: string,
    source: string,
    messageCount: number
  ) => void;
  onArtifact?: (openuiLang: string, title: string) => void;
  onUserQuestions?: (questions: UserQuestionItem[], toolCallId: string) => void;
}

export interface AgentSocketParams {
  sessionId: string;
  message: string;
  workspacePath: string;
  model?: string;
}

export interface UseAgentSocketReturn {
  execute: (
    params: AgentSocketParams,
    callbacks: AgentSocketCallbacks
  ) => Promise<void>;
  abort: () => void;
  stop: (sessionId: string) => void;
  approve: (
    sessionId: string,
    toolCallId: string,
    approved: boolean
  ) => void;
}

const GATEWAY_PORT: number = process.env.NEXT_PUBLIC_GATEWAY_PORT
  ? parseInt(process.env.NEXT_PUBLIC_GATEWAY_PORT, 10)
  : 3031;

const RELAY_EVENTS: string[] = [
  "agent:message_start",
  "agent:message_delta",
  "agent:reasoning_start",
  "agent:reasoning_delta",
  "agent:section_end",
  "agent:citation",
  "agent:artifact",
  "agent:session_compacted",
  "agent:session_updated",
  "agent:stopped",
  "agent:done",
  "agent:error",
  "tool:approval_required",
  "tool:start",
  "tool:delta",
  "tool:request",
  "gateway:connected",
  "gateway:disconnected",
  "gateway:error",
];

export function useAgentSocket(
  _backendUrl: string,
  _authToken: string
): UseAgentSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef<AgentSocketCallbacks>({});
  const accumulatedContentRef = useRef<string>("");

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const ensureConnected = useCallback((): Promise<Socket> => {
    return new Promise<Socket>((resolve, reject) => {
      if (socketRef.current?.connected) {
        resolve(socketRef.current);
        return;
      }

      socketRef.current?.disconnect();

      const socket = io(`http://127.0.0.1:${GATEWAY_PORT}`, {
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 10000,
      });

      for (const event of RELAY_EVENTS) {
        socket.on(event, (data: unknown) => {
          dispatchEvent(
            event,
            (data as Record<string, unknown>) || {},
            callbacksRef,
            accumulatedContentRef
          );
        });
      }

      socket.on("connect", () => {
        socketRef.current = socket;
        resolve(socket);
      });

      socket.on("connect_error", (err: Error) => {
        console.error(
          "[useAgentSocket] Connection error to gateway server:",
          err.message
        );
        if (!socketRef.current) {
          reject(
            new Error(
              `Failed to connect to gateway server on port ${GATEWAY_PORT}: ${err.message}`
            )
          );
        }
      });

      socket.on("disconnect", (reason: string) => {
        console.warn(
          "[useAgentSocket] Disconnected from gateway server:",
          reason
        );
      });
    });
  }, []);

  const execute = useCallback(
    async (
      params: AgentSocketParams,
      callbacks: AgentSocketCallbacks
    ): Promise<void> => {
      callbacksRef.current = callbacks;
      accumulatedContentRef.current = "";

      const socket = await ensureConnected();

      socket.emit(
        "agent:execute",
        {
          session_id: params.sessionId,
          message: params.message,
          workspace_path: params.workspacePath,
          model: params.model,
        },
        (ack: { session_id: string; error?: string }) => {
          if (ack?.error) {
            callbacksRef.current.onError?.(ack.error);
          }
        }
      );
    },
    [ensureConnected]
  );

  const abort = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  const stop = useCallback((sessionId: string) => {
    socketRef.current?.emit(
      "agent:stop",
      { session_id: sessionId },
      (ack: { session_id: string; error?: string }) => {
        if (ack?.error) {
          callbacksRef.current.onError?.(ack.error);
        }
      }
    );
  }, []);

  const approve = useCallback(
    (sessionId: string, toolCallId: string, approved: boolean) => {
      socketRef.current?.emit("tool:approval", {
        session_id: sessionId,
        tool_call_id: toolCallId,
        approved,
      });
    },
    []
  );

  return { execute, abort, stop, approve };
}

// ── Event dispatcher ──

function dispatchEvent(
  event: string,
  data: Record<string, unknown>,
  callbacksRef: React.MutableRefObject<AgentSocketCallbacks>,
  accumulatedContentRef: React.MutableRefObject<string>
): void {
  const cbs = callbacksRef.current;

  switch (event) {
    case "agent:reasoning_start":
      cbs.onThinking?.();
      break;

    case "agent:message_delta": {
      const content = (data.content as string) || "";
      accumulatedContentRef.current += content;
      cbs.onText?.(content);
      break;
    }

    case "tool:start":
      cbs.onToolStart?.(
        data.tool_name as string,
        {},
        data.tool_call_id as string
      );
      break;

    case "tool:request": {
      const toolName = data.tool_name as string;
      const toolInput = (data.tool_input as Record<string, unknown>) || {};
      const toolCallId = data.tool_call_id as string;

      if (toolName === "ask_user") {
        const questions = toolInput.questions as UserQuestionItem[];
        cbs.onUserQuestions?.(questions, toolCallId);
      } else {
        cbs.onToolStart?.(toolName, toolInput, toolCallId);
      }
      break;
    }

    case "tool:delta": {
      const toolName = data.tool_name as string;
      const toolCallId = data.tool_call_id as string;
      const responseType = data.response_type as string;
      const isError = responseType === "error";

      const rawData = data.data;
      const output =
        typeof rawData === "string"
          ? rawData
          : JSON.stringify(rawData ?? "");

      cbs.onToolResult?.(
        toolName,
        isError ? "" : output,
        isError ? output : undefined,
        toolCallId
      );

      if (data.openui_response) {
        const artifactTitle =
          typeof rawData === "object" && rawData !== null
            ? ((rawData as Record<string, unknown>).title as string)
            : undefined;
        cbs.onArtifact?.(
          data.openui_response as string,
          typeof artifactTitle === "string" ? artifactTitle : toolName
        );
      }
      break;
    }

    case "tool:approval_required":
      cbs.onApprovalRequired?.(
        data.tool_name as string,
        (data.tool_input as Record<string, unknown>) || {},
        data.tool_call_id as string,
        (data.gateway_id as string) ?? null
      );
      break;

    case "agent:artifact":
      cbs.onArtifact?.(
        data.openui_lang as string,
        data.title as string
      );
      break;

    case "agent:session_compacted":
      cbs.onSessionCompacted?.(
        data.new_session_id as string,
        data.summary as string
      );
      break;

    case "agent:session_updated":
      cbs.onSessionUpdated?.(
        data.session_id as string,
        (data.source as string) || "unknown",
        (data.message_count as number) || 0
      );
      break;

    case "agent:stopped":
      cbs.onStopped?.();
      cbs.onDone?.();
      break;

    case "agent:done":
      cbs.onComplete?.(accumulatedContentRef.current);
      cbs.onDone?.();
      break;

    case "agent:error":
      cbs.onError?.((data.error as string) || "Unknown error");
      cbs.onDone?.();
      break;

    case "gateway:connected":
    case "gateway:disconnected":
    case "gateway:error":
      break;

    default:
      break;
  }
}

// Re-exported helpers for drop-in replacement
export {
  createToolCallInfo,
  updateToolCallWithResult,
  updateToolCallApprovalRequired,
} from "./useAgentSSE";
