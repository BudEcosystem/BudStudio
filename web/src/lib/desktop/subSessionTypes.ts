/**
 * Sub-session TypeScript interfaces for multi-session support.
 *
 * These types model the backend's sub-session lifecycle: a parent session
 * can spawn child sessions that run tasks independently and report back.
 */

export type SubSessionStatus = "ACTIVE" | "COMPLETED" | "FAILED" | "INACTIVE";
export type SubSessionExecutionStatus = "IDLE" | "RUNNING" | "AWAITING_TOOL" | "AWAITING_APPROVAL";
export type SubSessionType = "SUB_ONE_SHOT" | "SUB_PERSISTENT";

export interface SubSessionSummary {
  session_id: string;
  parent_session_id: string;
  task: string;
  task_name: string;
  status: SubSessionStatus;
  execution_status: SubSessionExecutionStatus;
  session_type: SubSessionType;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  turns_completed: number;
  tokens_used: number;
  tool_calls: number;
}

export interface ThreadMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  timestamp: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
  tool_error?: string;
}

/**
 * API response shape for fetching sub-sessions of a parent.
 */
export interface SubSessionsResponse {
  sub_sessions: SubSessionSummary[];
}

/**
 * API response shape for fetching a sub-session's thread/history.
 */
export interface SubSessionThreadResponse {
  session: SubSessionSummary | null;
  messages: ThreadMessage[];
}

/**
 * API request shape for spawning a new sub-session.
 */
export interface SpawnSubSessionRequest {
  task: string;
  mode: string;
}

/**
 * API response shape for spawning a new sub-session.
 */
export interface SpawnSubSessionResponse {
  session_id: string;
  parent_session_id: string;
  task: string;
  mode: string;
}
