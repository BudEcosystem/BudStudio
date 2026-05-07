export { useIsDesktop, isDesktopApp } from "./hooks";
export {
  useAgentSocket,
  createToolCallInfo,
  updateToolCallWithResult,
  updateToolCallApprovalRequired,
  type AgentSocketParams,
  type AgentSocketCallbacks,
  type SubSessionStreamEvent,
} from "./useAgentSocket";
export {
  useChatInteractionState,
  type PendingMemoryUpdate,
  type BottomApprovalState,
} from "./useChatInteractionState";
export {
  useSubSessions,
  type UseSubSessionsReturn,
} from "./useSubSessions";
export {
  useSubSessionThread,
  type UseSubSessionThreadReturn,
} from "./useSubSessionThread";
export type {
  SubSessionSummary,
  SubSessionStatus,
  SubSessionType,
  ThreadMessage,
  SubSessionsResponse,
  SubSessionThreadResponse,
  SpawnSubSessionRequest,
  SpawnSubSessionResponse,
} from "./subSessionTypes";
