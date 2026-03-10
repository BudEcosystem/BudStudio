import { useState, useRef } from "react";
import type { ChatState } from "@/app/chat/interfaces";
import type { Packet } from "@/app/chat/services/streamingModels";
import type { ToolCallInfo } from "@/components/desktop/AgentSessionContext";

/**
 * Pending memory update from the agent.
 */
export interface PendingMemoryUpdate {
  toolCallId: string;
  toolName: string;
  filePath: string;
  oldContent: string;
  newContent: string;
}

/**
 * Bottom approval bar state for tool calls that need user consent.
 */
export interface BottomApprovalState {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  operationHash: string;
  gatewayId: string | null;
}

/**
 * Groups the streaming-related refs and chat UI state used during an
 * agent interaction.  Exposes `resetStreamingRefs` (called at the start
 * of each new agent turn) and `resetAll` (called when the user starts
 * a brand-new chat).
 */
export function useChatInteractionState() {
  // ── UI state ───────────────────────────────────────────────────────
  const [message, setMessage] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [chatState, setChatState] = useState<ChatState>("input");
  const [pendingMemoryUpdate, setPendingMemoryUpdate] =
    useState<PendingMemoryUpdate | null>(null);
  const [sidebarSourcesMsgId, setSidebarSourcesMsgId] = useState<
    string | null
  >(null);
  const [bottomApproval, setBottomApproval] =
    useState<BottomApprovalState | null>(null);

  // ── Streaming refs ─────────────────────────────────────────────────
  const accumulatedContentRef = useRef<string>("");
  const toolCallsRef = useRef<ToolCallInfo[]>([]);
  const packetsRef = useRef<Packet[]>([]);
  const messageFinalizedRef = useRef<boolean>(false);
  const currentAgentMessageIdRef = useRef<string | null>(null);

  // ── Reset helpers ──────────────────────────────────────────────────

  /** Reset only streaming refs (start of a new agent turn). */
  const resetStreamingRefs = () => {
    accumulatedContentRef.current = "";
    toolCallsRef.current = [];
    packetsRef.current = [];
    messageFinalizedRef.current = false;
  };

  /** Reset all state + refs (start of a brand-new chat). */
  const resetAll = () => {
    setIsProcessing(false);
    setChatState("input");
    setMessage("");
    setPendingMemoryUpdate(null);
    setBottomApproval(null);
    setSidebarSourcesMsgId(null);
    resetStreamingRefs();
    currentAgentMessageIdRef.current = null;
  };

  return {
    // State
    message,
    setMessage,
    isProcessing,
    setIsProcessing,
    chatState,
    setChatState,
    pendingMemoryUpdate,
    setPendingMemoryUpdate,
    sidebarSourcesMsgId,
    setSidebarSourcesMsgId,
    bottomApproval,
    setBottomApproval,

    // Refs
    accumulatedContentRef,
    toolCallsRef,
    packetsRef,
    messageFinalizedRef,
    currentAgentMessageIdRef,

    // Reset helpers
    resetStreamingRefs,
    resetAll,
  };
}
