"use client";

import { useRef, useCallback, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import type {
  Packet,
  UserQuestionItem,
  SubSessionSpawnedObj,
  SubSessionProgressObj,
  SubSessionCompleteObj,
  SubSessionFailedObj,
} from "@/app/chat/services/streamingModels";
import type { ToolCallInfo } from "@/components/desktop/AgentSessionContext";

// ── Callback interface ──

export interface AgentSocketCallbacks {
  /** Called with a synthesized Packet for the existing packet-based UI. */
  onPacket?: (packet: Packet) => void;
  onThinking?: () => void;
  onThinkingDelta?: (content: string) => void;
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
  /** Called with real DB message IDs after the backend persists messages.
   *  Either userMessageId or assistantMessageId will be set (not both).
   */
  onMessageIds?: (ids: { userMessageId?: string; assistantMessageId?: string }) => void;
  /** Called after a Socket.IO reconnect when an execution was in flight. */
  onReconnected?: (sessionId: string) => void;

  // Sub-session lifecycle callbacks
  onSubSessionSpawned?: (data: SubSessionSpawnedObj) => void;
  onSubSessionProgress?: (data: SubSessionProgressObj) => void;
  onSubSessionComplete?: (data: SubSessionCompleteObj) => void;
  onSubSessionFailed?: (data: SubSessionFailedObj) => void;

  // Sub-session streaming callbacks
  onSubSessionStream?: (data: SubSessionStreamEvent) => void;
}

/** Streaming delta event from a sub-session running in a Celery worker. */
export interface SubSessionStreamEvent {
  type: "text_delta" | "reasoning_delta" | "tool_start" | "tool_result" | "section_end";
  sub_session_id: string;
  parent_session_id?: string;
  delta?: string;
  tool_name?: string;
  tool_call_id?: string;
  result?: string;
  step?: number;
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
  /** Join a session room to receive streaming events without executing. */
  joinSession: (sessionId: string, callbacks: AgentSocketCallbacks) => Promise<void>;
  /** Join a session room without touching callbacks or executing state. */
  rejoinRoom: (sessionId: string) => Promise<void>;
  abort: () => void;
  stop: (sessionId: string) => void;
  approve: (
    sessionId: string,
    toolCallId: string,
    approved: boolean
  ) => void;
  sendToolResult: (
    sessionId: string,
    toolCallId: string,
    output: string | null,
    error: string | null
  ) => void;
}

const GATEWAY_PORT: number = process.env.NEXT_PUBLIC_GATEWAY_PORT
  ? parseInt(process.env.NEXT_PUBLIC_GATEWAY_PORT, 10)
  : 3031;

/**
 * Determine whether to connect via the local gateway relay (desktop/Tauri)
 * or directly to the backend's Socket.IO endpoint (cloud deployment).
 */
async function getSocketConfig(backendUrl: string): Promise<{
  url: string;
  opts: Parameters<typeof io>[1];
}> {
  // Only check real Tauri runtime indicators — NOT localStorage, which can
  // persist across environments and cause false positives in cloud mode.
  const isDesktop =
    typeof window !== "undefined" &&
    // @ts-ignore
    (window.__TAURI__ !== undefined ||
      // @ts-ignore
      window.__TAURI_INTERNALS__ !== undefined ||
      navigator.userAgent.includes("Tauri"));

  if (isDesktop) {
    // Desktop: connect to local gateway relay server.
    // The HttpOnly cookie can't be sent cross-port by the browser, so
    // we fetch the token from a same-origin API endpoint first and pass
    // it explicitly in the auth payload.
    let authToken = "";
    try {
      const resp = await fetch("/api/auth/session-token");
      if (resp.ok) {
        const data = await resp.json();
        authToken = data.token || "";
      }
    } catch {
      // ignore — gateway will reject without auth
    }

    return {
      url: `http://127.0.0.1:${GATEWAY_PORT}`,
      opts: {
        auth: { token: authToken },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        timeout: 10000,
      },
    };
  }

  // Cloud: connect directly to backend Socket.IO endpoint.
  // The backend mounts Socket.IO at /ws/agent.
  // Use the page origin so the request goes through the ingress/proxy.
  const origin =
    typeof window !== "undefined" ? window.location.origin : backendUrl;
  return {
    url: origin,
    opts: {
      path: "/api/ws/agent/",
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 10000,
    },
  };
}

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
  "agent:message_ids",
  "agent:sub_session_spawned",
  "agent:sub_session_progress",
  "agent:sub_session_complete",
  "agent:sub_session_failed",
  "agent:sub_session_stream",
  "gateway:connected",
  "gateway:disconnected",
  "gateway:error",
];

export function useAgentSocket(
  backendUrl: string,
  _authToken: string,
  options?: { forceNew?: boolean }
): UseAgentSocketReturn {
  const socketRef = useRef<Socket | null>(null);
  const callbacksRef = useRef<AgentSocketCallbacks>({});
  const accumulatedContentRef = useRef<string>("");
  /** Session ID of an in-flight execution (set on execute, cleared on done). */
  const executingSessionRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  const ensureConnected = useCallback(async (): Promise<Socket> => {
    if (socketRef.current?.connected) {
      return socketRef.current;
    }

    socketRef.current?.disconnect();

    const config = await getSocketConfig(backendUrl);
    if (options?.forceNew) {
      config.opts = { ...config.opts, forceNew: true };
    }

    return new Promise<Socket>((resolve, reject) => {
      const socket = io(config.url, config.opts);

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
          "[useAgentSocket] Disconnected from server:",
          reason
        );
      });

      // Handle automatic reconnection when an execution was in flight.
      // Socket.IO fires "connect" (not a separate "reconnect") on every
      // successful reconnect.  We detect reconnects by checking whether
      // socketRef was already set (initial connect sets it, so subsequent
      // "connect" events are reconnects).
      socket.io.on("reconnect", () => {
        const sessionId = executingSessionRef.current;
        if (!sessionId) return;

        console.info(
          "[useAgentSocket] Reconnected while executing session",
          sessionId,
          "— re-joining room"
        );

        // Re-join the session room on the backend so that the in-flight
        // LLM coroutine's room-based emits reach this new sid.
        socket.emit(
          "agent:rejoin",
          { session_id: sessionId },
          (ack: { ok?: boolean; error?: string }) => {
            if (ack?.error) {
              console.warn("[useAgentSocket] agent:rejoin error:", ack.error);
            }
          }
        );

        // Notify the UI so it can poll execution status and recover.
        callbacksRef.current.onReconnected?.(sessionId);
      });
    });
  }, []);

  const execute = useCallback(
    async (
      params: AgentSocketParams,
      callbacks: AgentSocketCallbacks
    ): Promise<void> => {
      // Wrap terminal callbacks to clear the executing session ref.
      const wrappedCallbacks: AgentSocketCallbacks = {
        ...callbacks,
        onDone: () => {
          executingSessionRef.current = null;
          callbacks.onDone?.();
        },
        onError: (error: string) => {
          executingSessionRef.current = null;
          callbacks.onError?.(error);
        },
        onStopped: () => {
          executingSessionRef.current = null;
          callbacks.onStopped?.();
        },
      };
      callbacksRef.current = wrappedCallbacks;
      accumulatedContentRef.current = "";
      executingSessionRef.current = params.sessionId;

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
            executingSessionRef.current = null;
            callbacksRef.current.onError?.(ack.error);
          }
        }
      );
    },
    [ensureConnected]
  );

  /**
   * Join a session's Socket.IO room to receive streaming events
   * without sending a message. Used by the thread panel to watch
   * background Celery sub-session execution in real time.
   */
  const joinSession = useCallback(
    async (sessionId: string, callbacks: AgentSocketCallbacks): Promise<void> => {
      callbacksRef.current = callbacks;
      accumulatedContentRef.current = "";
      executingSessionRef.current = sessionId;

      const socket = await ensureConnected();
      socket.emit(
        "agent:rejoin",
        { session_id: sessionId },
        (ack: { ok?: boolean; error?: string }) => {
          if (ack?.error) {
            console.warn("[useAgentSocket] joinSession error:", ack.error);
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

  const sendToolResult = useCallback(
    (sessionId: string, toolCallId: string, output: string | null, error: string | null) => {
      socketRef.current?.emit("tool:result", {
        session_id: sessionId,
        tool_call_id: toolCallId,
        output,
        error,
      });
    },
    []
  );

  /** Join a session room without touching callbacks or executing state. */
  const rejoinRoom = useCallback(
    async (sessionId: string): Promise<void> => {
      const socket = await ensureConnected();
      socket.emit("agent:rejoin", { session_id: sessionId });
    },
    [ensureConnected]
  );

  return { execute, joinSession, rejoinRoom, abort, stop, approve, sendToolResult };
}

// ── Event dispatcher ──

function dispatchEvent(
  event: string,
  data: Record<string, unknown>,
  callbacksRef: React.MutableRefObject<AgentSocketCallbacks>,
  accumulatedContentRef: React.MutableRefObject<string>
): void {
  const cbs = callbacksRef.current;

  // Helper: synthesize a Packet and forward to onPacket callback.
  const ind = (data.ind as number) ?? 0;
  const emitPacket = (obj: Record<string, unknown>) => {
    cbs.onPacket?.({ ind, obj: obj as Packet["obj"] });
  };

  switch (event) {
    case "agent:reasoning_start":
      emitPacket({ type: "reasoning_start" });
      cbs.onThinking?.();
      break;

    case "agent:reasoning_delta": {
      const reasoning = (data.reasoning as string) || "";
      emitPacket({ type: "reasoning_delta", reasoning });
      cbs.onThinkingDelta?.(reasoning);
      break;
    }

    case "agent:section_end":
      emitPacket({ type: "section_end" });
      break;

    case "agent:message_start": {
      const startContent = (data.content as string) || "";
      emitPacket({ type: "message_start", content: startContent });
      break;
    }

    case "agent:message_delta": {
      const content = (data.content as string) || "";
      emitPacket({ type: "message_delta", content });
      accumulatedContentRef.current += content;
      cbs.onText?.(content);
      break;
    }

    case "agent:citation": {
      const citations = data.citations as unknown[];
      if (citations) {
        emitPacket({ type: "citation_delta", citations });
      }
      break;
    }

    case "tool:start": {
      const toolName = data.tool_name as string;
      // Map tool_name to the correct packet type for the renderer
      if (toolName === "web_search") {
        emitPacket({ type: "internal_search_tool_start", is_internet_search: true });
      } else if (toolName === "open_url") {
        emitPacket({ type: "fetch_tool_start", queries: null, documents: null });
      } else {
        emitPacket({ type: "custom_tool_start", tool_name: toolName });
      }
      cbs.onToolStart?.(
        toolName,
        {},
        data.tool_call_id as string
      );
      break;
    }

    case "tool:request": {
      const toolName = data.tool_name as string;
      const toolInput = (data.tool_input as Record<string, unknown>) || {};
      const toolCallId = data.tool_call_id as string;

      if (toolName === "ask_user" || toolName === "ask_user_questions") {
        cbs.onUserQuestions?.(toolInput.questions as UserQuestionItem[], toolCallId);
      } else {
        emitPacket({ type: "custom_tool_start", tool_name: toolName });
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

      // Map tool_name to correct packet type for the renderer
      if (toolName === "web_search" && rawData && typeof rawData === "object") {
        const results = rawData as Record<string, unknown>;
        // Extract documents from search_docs (packet drainer) or
        // reconstructed tool output.  Fall back to null if absent.
        const searchDocs = (results.search_docs as unknown[] | undefined) ?? null;
        const queries = (results.queries as string[] | undefined)
          ?? (results.results as unknown[] | undefined)?.map(
            (r: unknown) => (r as Record<string, string>).title
          )
          ?? [];
        emitPacket({
          type: "internal_search_tool_delta",
          queries,
          documents: searchDocs,
        });
      } else if (toolName === "open_url" && rawData && typeof rawData === "object") {
        const results = rawData as Record<string, unknown>;
        const fetchDocs = (results.fetch_docs as unknown[] | undefined) ?? null;
        if (fetchDocs) {
          emitPacket({
            type: "fetch_tool_start",
            documents: fetchDocs,
          });
        } else {
          emitPacket({
            type: "custom_tool_delta",
            tool_name: toolName,
            response_type: responseType,
            data: rawData,
            openui_response: data.openui_response ?? null,
            file_ids: data.file_ids ?? null,
          });
        }
      } else {
        emitPacket({
          type: "custom_tool_delta",
          tool_name: toolName,
          response_type: responseType,
          data: rawData,
          openui_response: data.openui_response ?? null,
          file_ids: data.file_ids ?? null,
        });
      }
      // Section end after tool delta (mirrors SSE behavior)
      emitPacket({ type: "section_end" });

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

    case "agent:message_ids":
      cbs.onMessageIds?.({
        userMessageId: data.user_message_id as string | undefined,
        assistantMessageId: data.assistant_message_id as string | undefined,
      });
      break;

    case "agent:stopped":
      emitPacket({ type: "stop" });
      cbs.onStopped?.();
      cbs.onDone?.();
      break;

    case "agent:done":
      emitPacket({ type: "stop" });
      cbs.onComplete?.(accumulatedContentRef.current);
      cbs.onDone?.();
      break;

    case "agent:error":
      cbs.onError?.((data.error as string) || "Unknown error");
      cbs.onDone?.();
      break;

    case "agent:sub_session_spawned":
      cbs.onSubSessionSpawned?.({
        type: "sub_session_spawned",
        parent_session_id: data.parent_session_id as string,
        sub_session_id: data.sub_session_id as string,
        task: data.task as string,
        task_name: data.task_name as string | undefined,
        mode: data.mode as string,
      });
      break;

    case "agent:sub_session_progress":
      cbs.onSubSessionProgress?.({
        type: "sub_session_progress",
        sub_session_id: data.sub_session_id as string,
        turns_completed: (data.turns_completed as number) ?? 0,
        tokens_used: data.tokens_used as number | undefined,
      });
      break;

    case "agent:sub_session_complete":
      cbs.onSubSessionComplete?.({
        type: "sub_session_complete",
        sub_session_id: data.sub_session_id as string,
        task: data.task as string,
        summary: data.summary as string,
        status: data.status as string,
        message: (data.message as string) || undefined,
      });
      break;

    case "agent:sub_session_failed":
      cbs.onSubSessionFailed?.({
        type: "sub_session_failed",
        sub_session_id: data.sub_session_id as string,
        task: data.task as string,
        error: data.error as string | undefined,
        partial_result: data.partial_result as string | undefined,
        message: (data.message as string) || undefined,
      });
      break;

    case "agent:sub_session_stream":
      cbs.onSubSessionStream?.({
        type: data.type as SubSessionStreamEvent["type"],
        sub_session_id: data.sub_session_id as string,
        parent_session_id: data.parent_session_id as string | undefined,
        delta: data.delta as string | undefined,
        tool_name: data.tool_name as string | undefined,
        tool_call_id: data.tool_call_id as string | undefined,
        result: data.result as string | undefined,
        step: data.step as number | undefined,
      });
      break;

    case "gateway:connected":
    case "gateway:disconnected":
    case "gateway:error":
      break;

    default:
      break;
  }
}

// ── ToolCallInfo helpers ──

/**
 * Helper to create a ToolCallInfo object from tool_start event.
 */
export function createToolCallInfo(
  toolName: string,
  toolInput: Record<string, unknown>,
  toolCallId: string
): ToolCallInfo {
  return {
    id: toolCallId,
    name: toolName,
    input: toolInput,
    status: "running",
  };
}

/**
 * Helper to update a ToolCallInfo with tool_result.
 */
export function updateToolCallWithResult(
  toolCalls: ToolCallInfo[] | undefined,
  toolCallId: string,
  toolOutput: string,
  toolError?: string
): ToolCallInfo[] {
  if (!toolCalls) return [];

  return toolCalls.map((tc) =>
    tc.id === toolCallId
      ? {
          ...tc,
          output: toolOutput,
          error: toolError,
          status: toolError ? ("error" as const) : ("complete" as const),
        }
      : tc
  );
}

/**
 * Helper to update a ToolCallInfo to approval_required status.
 */
export function updateToolCallApprovalRequired(
  toolCalls: ToolCallInfo[] | undefined,
  toolCallId: string
): ToolCallInfo[] {
  if (!toolCalls) return [];

  return toolCalls.map((tc) =>
    tc.id === toolCallId
      ? {
          ...tc,
          status: "approval_required" as const,
        }
      : tc
  );
}
