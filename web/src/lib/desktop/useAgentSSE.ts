"use client";

import { useRef, useCallback } from "react";
import type { AgentEvent } from "@/lib/agent/types";
import type { ToolCallInfo } from "@/components/desktop/AgentSessionContext";

/**
 * Parameters for starting an agent execution.
 */
export interface AgentExecuteParams {
  sessionId: string;
  message: string;
  workspacePath: string;
}

/**
 * Callbacks for handling agent events.
 */
export interface AgentEventCallbacks {
  /** Called when the agent starts thinking */
  onThinking?: () => void;
  /** Called when the agent streams text */
  onText?: (content: string) => void;
  /** Called when a tool starts executing */
  onToolStart?: (toolName: string, toolInput: Record<string, unknown>, toolCallId: string) => void;
  /** Called when a tool completes */
  onToolResult?: (
    toolName: string,
    toolOutput: string,
    toolError: string | undefined,
    toolCallId: string
  ) => void;
  /** Called when a tool requires approval */
  onApprovalRequired?: (
    toolName: string,
    toolInput: Record<string, unknown>,
    toolCallId: string
  ) => void;
  /** Called when the agent completes successfully */
  onComplete?: (content: string) => void;
  /** Called when an error occurs */
  onError?: (error: string) => void;
  /** Called when the agent is stopped */
  onStopped?: () => void;
  /** Called when the SSE stream is done (after error, complete, or stopped) */
  onDone?: () => void;
  /** Called when the session is compacted and a new session is created */
  onSessionCompacted?: (newSessionId: string, summary: string) => void;
}

/**
 * Hook for executing an agent via SSE streaming.
 *
 * This hook manages the SSE connection to the local agent API and
 * provides callbacks for handling different event types.
 *
 * @returns An object with execute and abort functions
 */
export function useAgentSSE() {
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * Execute an agent request and stream events via SSE.
   */
  const execute = useCallback(
    async (params: AgentExecuteParams, callbacks: AgentEventCallbacks): Promise<void> => {
      // Abort any existing connection
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create a new abort controller
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      try {
        // Detect the user's timezone from the browser
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

        // Read the SSE stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          // Decode and add to buffer
          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          for (const line of lines) {
            const trimmedLine = line.trim();

            // Skip empty lines and comments
            if (!trimmedLine || trimmedLine.startsWith(":")) {
              continue;
            }

            // Parse SSE data lines
            if (trimmedLine.startsWith("data: ")) {
              const jsonStr = trimmedLine.slice(6);
              try {
                const event = JSON.parse(jsonStr) as AgentEvent;
                handleEvent(event, callbacks);

                // Check for terminal events
                if (
                  event.type === "done" ||
                  event.type === "error" ||
                  event.type === "stopped"
                ) {
                  return;
                }
              } catch (e) {
                console.error("Failed to parse SSE event:", e, jsonStr);
              }
            }
          }
        }

        // Process any remaining buffer
        if (buffer.trim()) {
          const trimmedLine = buffer.trim();
          if (trimmedLine.startsWith("data: ")) {
            const jsonStr = trimmedLine.slice(6);
            try {
              const event = JSON.parse(jsonStr) as AgentEvent;
              handleEvent(event, callbacks);
            } catch (e) {
              console.error("Failed to parse final SSE event:", e, jsonStr);
            }
          }
        }

        // If we got here without a done event, call onDone
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

  /**
   * Abort the current SSE connection.
   */
  const abort = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  return { execute, abort };
}

/**
 * Handle an agent event by calling the appropriate callback.
 */
function handleEvent(event: AgentEvent, callbacks: AgentEventCallbacks): void {
  switch (event.type) {
    case "thinking":
      callbacks.onThinking?.();
      break;
    case "text":
      callbacks.onText?.(event.content);
      break;
    case "tool_start":
      callbacks.onToolStart?.(event.toolName, event.toolInput, event.toolCallId);
      break;
    case "tool_result":
      callbacks.onToolResult?.(event.toolName, event.toolOutput, event.toolError, event.toolCallId);
      break;
    case "approval_required":
      callbacks.onApprovalRequired?.(event.toolName, event.toolInput, event.toolCallId);
      break;
    case "complete":
      callbacks.onComplete?.(event.content);
      break;
    case "error":
      callbacks.onError?.(event.error);
      break;
    case "stopped":
      callbacks.onStopped?.();
      break;
    case "done":
      callbacks.onDone?.();
      break;
    case "session_compacted":
      callbacks.onSessionCompacted?.(event.newSessionId, event.summary);
      break;
  }
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
