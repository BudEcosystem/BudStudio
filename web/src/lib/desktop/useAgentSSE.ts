"use client";

import { useRef, useCallback } from "react";
import type { Packet, PacketType, UserQuestionItem } from "@/app/chat/services/streamingModels";
import type { ToolCallInfo } from "@/components/desktop/AgentSessionContext";

/**
 * Parameters for starting an agent execution.
 */
export interface AgentExecuteParams {
  sessionId: string;
  message: string;
  workspacePath: string;
  model?: string;
}

/**
 * Callbacks for handling agent packets and events.
 */
export interface AgentEventCallbacks {
  /** Called for each incoming packet (unified rendering path) */
  onPacket?: (packet: Packet) => void;
  /** Called when the agent starts thinking (reasoning_start packet) */
  onThinking?: () => void;
  /** Called when the agent streams text (message_delta packet) */
  onText?: (content: string) => void;
  /** Called when a tool starts executing (custom_tool_start packet) */
  onToolStart?: (toolName: string, toolInput: Record<string, unknown>, toolCallId: string) => void;
  /** Called when a tool completes (custom_tool_delta with result) */
  onToolResult?: (
    toolName: string,
    toolOutput: string,
    toolError: string | undefined,
    toolCallId: string
  ) => void;
  /** Called when a tool requires approval (agent_approval_required packet) */
  onApprovalRequired?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolCallId: string,
    gatewayId: string | null
  ) => void;
  /** Called when streaming completes (stop packet) */
  onComplete?: (content: string) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Called when the agent is stopped */
  onStopped?: () => void;
  /** Called when the SSE stream is done (agent_done packet or stream end) */
  onDone?: () => void;
  /** Called when the session is compacted */
  onSessionCompacted?: (newSessionId: string, summary: string) => void;
  /** Called when artifact content is generated (artifact_generation packet) */
  onArtifact?: (openuiLang: string, title: string) => void;
  /** Called when the agent asks the user clarifying questions */
  onUserQuestions?: (questions: UserQuestionItem[], toolCallId: string) => void;
}

/**
 * Hook for executing an agent via SSE streaming.
 *
 * SSE events arrive as Packet objects: { ind: number, obj: { type: "...", ... } }
 * The hook dispatches to both unified onPacket callback and individual event callbacks.
 */
export function useAgentSSE() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const execute = useCallback(
    async (params: AgentExecuteParams, callbacks: AgentEventCallbacks): Promise<void> => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;
      let accumulatedContent = "";
      // Track tool_call_ids from agent_local_tool_request packets
      const toolCallIds = new Map<number, string>();

      try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        const response = await fetch("/api/local-agent/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            sessionId: params.sessionId,
            message: params.message,
            workspacePath: params.workspacePath,
            model: params.model,
            timezone,
          }),
          signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: "Request failed" }));
          callbacks.onError?.(errorData.error || `HTTP ${response.status}`);
          callbacks.onDone?.();
          return;
        }

        if (!response.body) {
          callbacks.onError?.("Response body is empty");
          callbacks.onDone?.();
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmedLine = line.trim();

            if (!trimmedLine || trimmedLine.startsWith(":")) {
              continue;
            }

            // Parse JSON line (not SSE data: prefix for packet format)
            let jsonStr = trimmedLine;
            if (trimmedLine.startsWith("data: ")) {
              jsonStr = trimmedLine.slice(6);
            }

            try {
              const packet = JSON.parse(jsonStr) as Packet;

              // Dispatch to onPacket for unified rendering
              callbacks.onPacket?.(packet);

              // Also dispatch to individual callbacks for backward compat
              const terminated = handlePacket(
                packet,
                callbacks,
                accumulatedContent,
                toolCallIds,
                (c: string) => { accumulatedContent = c; }
              );

              if (terminated) {
                return;
              }
            } catch (e) {
              console.error("Failed to parse SSE packet:", e, jsonStr);
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          let jsonStr = buffer.trim();
          if (jsonStr.startsWith("data: ")) {
            jsonStr = jsonStr.slice(6);
          }
          try {
            const packet = JSON.parse(jsonStr) as Packet;
            callbacks.onPacket?.(packet);
            handlePacket(packet, callbacks, accumulatedContent, toolCallIds, (c: string) => { accumulatedContent = c; });
          } catch (e) {
            console.error("Failed to parse final SSE packet:", e, jsonStr);
          }
        }

        callbacks.onDone?.();
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          callbacks.onStopped?.();
          callbacks.onDone?.();
          return;
        }

        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        callbacks.onError?.(errorMessage);
        callbacks.onDone?.();
      } finally {
        abortControllerRef.current = null;
      }
    },
    []
  );

  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return { execute, abort };
}

/**
 * Handle a Packet by dispatching to the appropriate callback.
 * Returns true if this is a terminal event.
 */
function handlePacket(
  packet: Packet,
  callbacks: AgentEventCallbacks,
  accumulatedContent: string,
  toolCallIds: Map<number, string>,
  setContent: (c: string) => void,
): boolean {
  const obj = packet.obj;
  if (!obj) return false;
  const type = obj.type;

  switch (type) {
    case "reasoning_start":
      callbacks.onThinking?.();
      break;

    case "message_delta": {
      const content = (obj as { content: string }).content;
      const newContent = accumulatedContent + content;
      setContent(newContent);
      callbacks.onText?.(content);
      break;
    }

    case "custom_tool_start": {
      const toolObj = obj as { tool_name: string };
      callbacks.onToolStart?.(toolObj.tool_name, {}, "");
      break;
    }

    case "custom_tool_delta": {
      const toolObj = obj as {
        tool_name: string;
        response_type: string;
        data?: unknown;
        openui_response?: string | null;
      };
      const output = typeof toolObj.data === "string" ? toolObj.data : JSON.stringify(toolObj.data ?? "");
      const isError = toolObj.response_type === "error";
      callbacks.onToolResult?.(
        toolObj.tool_name,
        isError ? "" : output,
        isError ? output : undefined,
        ""
      );
      // If the tool produced artifact content, open the artifact panel
      if (toolObj.openui_response) {
        const artifactTitle =
          (typeof toolObj.data === "object" && toolObj.data !== null
            ? (toolObj.data as Record<string, unknown>).title
            : undefined);
        callbacks.onArtifact?.(
          toolObj.openui_response,
          typeof artifactTitle === "string" ? artifactTitle : toolObj.tool_name
        );
      }
      break;
    }

    case "agent_approval_required": {
      const approvalObj = obj as {
        tool_name: string;
        tool_input: Record<string, unknown> | null;
        tool_call_id: string;
        gateway_id: string | null;
      };
      callbacks.onApprovalRequired?.(
        approvalObj.tool_name,
        approvalObj.tool_input || {},
        approvalObj.tool_call_id,
        approvalObj.gateway_id ?? null
      );
      break;
    }

    case "agent_local_tool_request": {
      const reqObj = obj as {
        tool_name: string;
        tool_input: Record<string, unknown> | null;
        tool_call_id: string;
      };
      // Track tool_call_id for this step
      toolCallIds.set(packet.ind, reqObj.tool_call_id);
      // Also emit as tool_start with actual tool_call_id
      callbacks.onToolStart?.(
        reqObj.tool_name,
        reqObj.tool_input || {},
        reqObj.tool_call_id
      );
      break;
    }

    case "stop":
      callbacks.onComplete?.(accumulatedContent);
      break;

    case "error": {
      const errorObj = obj as { exception?: string };
      callbacks.onError?.(errorObj.exception || "Unknown error");
      break;
    }

    case "agent_stopped":
      callbacks.onStopped?.();
      break;

    case "agent_done":
      callbacks.onDone?.();
      return true;

    case "agent_session_compacted": {
      const compactObj = obj as { new_session_id: string; summary: string };
      callbacks.onSessionCompacted?.(compactObj.new_session_id, compactObj.summary);
      break;
    }

    case "agent_user_questions": {
      const qObj = obj as { questions: UserQuestionItem[]; tool_call_id: string };
      callbacks.onUserQuestions?.(qObj.questions, qObj.tool_call_id);
      break;
    }

    case "artifact_generation": {
      const artifactObj = obj as { openui_lang: string; title: string };
      callbacks.onArtifact?.(artifactObj.openui_lang, artifactObj.title);
      break;
    }
  }

  return false;
}

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
