# Sub-Session System: Task List

**FRD:** `multi-session-frd.md` (v2.0)
**Scenarios:** `multi-session-scenarios.md`
**Date:** March 29, 2026
**Prerequisites:** architecture-v2 Phase 2 (AgentSessionEvent queue)

---

## Phase 0: Design Decisions

Resolve open design questions from the scenarios document before implementation.

- [x] **0.1** Decide: Spawn race condition strategy (S-2.2)
  - **Decision:** Option A — `SELECT ... FOR UPDATE` when checking + inserting sub-session count. Simplest, no extra lock management.

- [x] **0.2** Decide: Compaction while sub-sessions are active (S-2.6)
  - **Decision:** Option A — On compaction, UPDATE all active sub-sessions' `parent_session_id` to new session. Explicit, no chain traversal needed.

- [x] **0.3** Decide: New session ("New Chat") while sub-sessions are active (S-2.7)
  - **Decision:** Option B — Re-point sub-sessions to the new session, same as compaction. User keeps their work.

- [x] **0.4** Decide: Aggregate token budget for sub-sessions (S-4.2)
  - **Decision:** Option C — Configurable via env var, default to no limit for v1. Add aggregate limit later if needed.

- [x] **0.5** Decide: Dangerous tools in auto-approved sub-sessions (S-10.3)
  - **Decision:** Option A — Block `bash`, `write_file`, `edit_file`, `cli_agent` for all sub-sessions. Auto-approved + destructive tools is too risky.

- [x] **0.6** Decide: Data exfiltration via `open_url` (S-10.4)
  - **Decision:** Option B — Allow `open_url` but log all URLs for audit for v1.

---

## Phase 1: Database Foundation

### 1A: AgentSessionEvent Model + Migration (arch-v2 Phase 2)

- [x] **1A.1** Add `AgentSessionEvent` model to `backend/onyx/db/models.py`
  - Columns: `id` (UUID PK), `session_id` (FK → AgentSession), `event_type` (str), `payload` (JSONB), `priority` (int), `status` (str: pending/consumed/expired), `created_at`, `consumed_at`, `ttl_seconds`
  - Index: `(session_id, status, priority)` for efficient drain queries
  - Index: `(status, created_at)` for cleanup queries

- [x] **1A.2** Add `AgentEventType` enum to `backend/onyx/db/enums.py`
  - Values: `SUB_SESSION_COMPLETE`, `SUB_SESSION_FAILED`, `SUB_SESSION_TIMEOUT`, `SUB_SESSION_FOLLOW_UP`, `USER_MESSAGE`, `CRON_RESULT`, `INBOX_ESCALATION`, `API_TRIGGER`

- [x] **1A.3** Create `backend/onyx/db/agent_events.py` — CRUD operations
  - `enqueue_session_event(db, session_id, event_type, payload, priority, ttl_seconds)` → creates row with status=pending
  - `consume_pending_events(db, session_id)` → SELECT ... WHERE status='pending' ORDER BY priority, created_at; returns list
  - `mark_event_consumed(db, event_id)` → UPDATE status='consumed', consumed_at=now()
  - `expire_stale_events(db)` → UPDATE status='expired' WHERE ttl_seconds IS NOT NULL AND created_at + ttl_seconds < now()
  - `cleanup_old_events(db, days=7)` → DELETE WHERE status IN ('consumed', 'expired') AND created_at < now() - interval

- [x] **1A.4** Create Alembic migration `xxxx_add_agent_session_events.py`
  - Create `agent_session_event` table
  - Add indexes

- [x] **1A.5** Write unit tests for `agent_events.py`
  - Test enqueue + consume round-trip
  - Test priority ordering (lower priority number consumed first)
  - Test TTL expiry
  - Test cleanup of old consumed events
  - Test concurrent consume (only one consumer gets the event — use `FOR UPDATE SKIP LOCKED`)

### 1B: Session Type Column + Migration

- [x] **1B.1** Add `AgentSessionType` enum to `backend/onyx/db/enums.py`
  - Values: `INTERACTIVE`, `COMPACTED`, `CRON`, `INBOX`, `SUB_ONE_SHOT`, `SUB_PERSISTENT`

- [x] **1B.2** Add columns to `AgentSession` model in `backend/onyx/db/models.py`
  - `session_type: Mapped[AgentSessionType]` — with default `INTERACTIVE`, nullable initially for migration
  - `task_description: Mapped[str | None]` — natural language task for sub-sessions
  - `max_context_tokens: Mapped[int | None]` — token budget (null = default 32000)
  - `max_turns: Mapped[int | None]` — turn limit (null = default 30)
  - Add index: `(user_id, session_type, status)` for concurrency count queries

- [x] **1B.3** Create Alembic migration `xxxx_add_session_type.py`
  - Add columns (nullable)
  - Backfill:
    - Sessions with `compaction_summary IS NOT NULL` → `COMPACTED`
    - Sessions linked via `AgentCronExecution.session_id` → `CRON`
    - Remaining → `INTERACTIVE`
  - Make `session_type` NOT NULL after backfill

- [x] **1B.4** Update `create_session()` in `backend/onyx/db/agent.py`
  - Set `session_type=AgentSessionType.INTERACTIVE` explicitly

- [x] **1B.5** Update `create_cron_session()` in `backend/onyx/db/agent.py`
  - Set `session_type=AgentSessionType.CRON`

- [x] **1B.6** Add `create_sub_session()` function in `backend/onyx/db/agent.py`
  - Args: `db_session, user_id, parent_session_id, task_description, task_context, session_type (ONE_SHOT or PERSISTENT), max_context_tokens, max_turns`
  - Create `AgentSession` row with parent link
  - Return the new session

- [x] **1B.7** Add `count_active_sub_sessions()` function in `backend/onyx/db/agent.py`
  - Count sessions WHERE `user_id = X` AND `session_type IN (SUB_ONE_SHOT, SUB_PERSISTENT)` AND `status = ACTIVE`
  - Use `SELECT ... FOR UPDATE` per design decision 0.1

- [x] **1B.8** Add `get_sub_sessions_for_parent()` function in `backend/onyx/db/agent.py`
  - Return all sub-sessions WHERE `parent_session_id = X`, ordered by `created_at DESC`

- [x] **1B.9** Add `repoint_sub_sessions_parent()` function in `backend/onyx/db/agent.py`
  - UPDATE `parent_session_id` for all ACTIVE sub-sessions of old parent → new parent
  - Used by compaction (S-2.6) and new session (S-2.7) per design decisions

- [x] **1B.10** Write unit tests for new DB functions
  - Test `create_sub_session` creates correct session_type and parent link
  - Test `count_active_sub_sessions` counts only active sub types
  - Test `count_active_sub_sessions` with concurrent spawns (race condition, S-2.2)
  - Test `repoint_sub_sessions_parent` updates all active children

---

## Phase 2: Event Queue Integration

- [x] **2.1** Extend `AgentHandler.handle_execute()` in `backend/onyx/server/agent/agent_handler.py`
  - At the start of each turn (before building messages), call `consume_pending_events(db, session_id)`
  - For each pending event:
    - Format as system message: `format_event_as_system_message(event)`
    - Inject into session via `add_session_message(db, session_id, role=SYSTEM, content=...)`
    - Mark event consumed
  - Events are now part of the message history for the LLM turn

- [x] **2.2** Extend `AgentHandler.handle_tool_result()` in `backend/onyx/server/agent/agent_handler.py`
  - Same drain logic after all pending local tools are done, before running next LLM turn
  - Ensures events that arrived during tool execution are picked up

- [x] **2.3** Create `format_event_as_system_message()` helper
  - `SUB_SESSION_COMPLETE` → `"[Sub-session completed] Task: {task}. Summary: {summary}"`
  - `SUB_SESSION_FAILED` → `"[Sub-session failed] Task: {task}. Error: {error}. Partial result: {partial}"`
  - `SUB_SESSION_TIMEOUT` → `"[Sub-session timed out] Task: {task}. Partial result: {partial}"`
  - `CRON_RESULT` → `"[Cron job completed] Job: {job_name}. Result: {summary}"`
  - `INBOX_ESCALATION` → `"[Inbox escalation] From: {sender}. Reason: {reason}"`

- [x] **2.4** Write integration test: event injected while session is idle gets consumed on next turn
  - Enqueue a `SUB_SESSION_COMPLETE` event
  - Send a user message
  - Verify the system message appears in history before the user message
  - Verify the LLM's response references the sub-session result

- [x] **2.5** Write integration test: event injected during mid-turn gets consumed on next turn
  - Start a turn (user message)
  - While LLM is streaming, enqueue an event
  - Verify it's NOT in the current turn's context
  - Send another user message
  - Verify it IS consumed

- [x] **2.6** Add periodic task: `cleanup_agent_session_events` (runs hourly)
  - Call `expire_stale_events(db)` to expire events past TTL
  - Call `cleanup_old_events(db, days=7)` to delete old consumed/expired events
  - Register in Celery Beat schedule

---

## Phase 3: Sub-Session Execution Engine

### 3A: SubSessionEmitter + AutoApproveRequester

- [x] **3A.1** Create `backend/onyx/agents/bud_agent/sub_session_emitter.py`
  - `SubSessionEmitter` class implementing `TurnEmitter` protocol (from `turn_driver.py:49`)
    - `reasoning_start(step)` → no-op (no streaming for sub-sessions)
    - `reasoning_delta(delta, step)` → no-op
    - `text_start(step)` → no-op
    - `text_delta(delta, step)` → no-op
    - `section_end(step)` → no-op
    - `tool_start(tool_name, step)` → no-op
    - `tool_result_event(...)` → no-op
  - `AutoApproveRequester` class implementing `ToolRequester` protocol (from `turn_driver.py:75`)
    - `request(tool)` → immediately return approved (no user interaction)

- [x] **3A.2** Write unit test for `SubSessionEmitter`
  - Verify all protocol methods are callable and return without error
  - Verify no Socket.IO events are emitted

- [x] **3A.3** Write unit test for `AutoApproveRequester`
  - Verify all tool calls are approved without blocking

### 3B: AgentExecutionMode.SUB_SESSION

- [x] **3B.1** Add `SUB_SESSION` value to `AgentExecutionMode` enum in `backend/onyx/agents/bud_agent/agent_context.py:63`

- [x] **3B.2** Add `SUB_SESSION` entry to `MODE_TOOL_BLOCKLIST` in `backend/onyx/agents/bud_agent/agent_context.py:72`
  - Block: `ask_user_questions`, `render_canvas`, `spawn_sub_session`, `cancel_sub_session`, `send_to_sub_session`, `list_sub_sessions`, `inspect_sub_session`, `get_sub_session_result`
  - Also block dangerous tools per design decision 0.5: `bash`, `write_file`, `edit_file`, `cli_agent`

- [x] **3B.3** Update `build_agent_run_context()` in `backend/onyx/agents/bud_agent/agent_context.py:150`
  - Handle `SUB_SESSION` mode:
    - Use `task_description` as the initial user message
    - Include `task_context` in the system prompt
    - Apply `MODE_TOOL_BLOCKLIST[SUB_SESSION]`
    - Set `max_context_tokens` from session config
  - Skip: skill evolution, workspace file loading (sub-sessions don't have a workspace), inbox context

- [x] **3B.4** Add sub-session system prompt section
  - Create mode-specific prompt for sub-sessions:
    - "You are executing a background sub-session task. Focus exclusively on completing the task."
    - "Produce a clear, structured final answer when done."
    - "You cannot interact with the user directly."
    - "You do not have access to the user's desktop or file system."

### 3C: Celery Task

- [x] **3C.1** Create `backend/onyx/background/celery/tasks/sub_session/__init__.py`

- [x] **3C.2** Create `backend/onyx/background/celery/tasks/sub_session/tasks.py`
  - `execute_sub_session(session_id: str, tenant_id: str | None = None)` — `@shared_task`
    - `soft_time_limit` read from session's `max_turns * 30` or env default (600s)
    - `time_limit` = soft + 60s
    - Queue: PRIMARY, Priority: MEDIUM

- [x] **3C.3** Implement `execute_sub_session` task logic
  - Load `AgentSession` from DB, verify status=ACTIVE and type is SUB_*
  - Set Redis key `bud_agent_running:{session_id}` with TTL
  - Build agent context via `build_agent_run_context(mode=SUB_SESSION)`
  - Build message history from DB (or initial messages if first run)
  - Create `TurnDriverConfig` with `SubSessionEmitter` + `AutoApproveRequester`
  - Create `TurnDriver` instance
  - **Agent loop:**
    ```
    while not stopped and turns < max_turns:
        result = await turn_driver.run_next_turn(session_id, db, messages, ...)
        messages = result.final_messages
        turns += 1
        refresh Redis key TTL (heartbeat, S-12.5)
        if result has no tool calls: break (final answer)
        drain pending events (for persistent follow-ups, S-6.2)
    ```
  - On normal completion: call `_summarize_and_announce()`
  - On `SoftTimeLimitExceeded`: call `_summarize_partial_and_announce()`
  - On exception: call `_announce_failure()`
  - Clear Redis key `bud_agent_running:{session_id}`

- [x] **3C.4** Implement `_summarize_and_announce()` helper
  - Generate LLM summary of sub-session's work (< 500 words, focus on outcomes)
  - Enqueue `SUB_SESSION_COMPLETE` to parent via `enqueue_session_event()`
  - Inject system message into parent session: `add_session_message(db, parent_id, role=SYSTEM, ...)`
  - Update sub-session status → COMPLETED
  - Publish Redis event for Socket.IO notification

- [x] **3C.5** Implement `_summarize_partial_and_announce()` helper
  - Generate LLM summary of partial progress
  - Enqueue `SUB_SESSION_TIMEOUT` to parent
  - Inject system message into parent session
  - Update sub-session status → FAILED

- [x] **3C.6** Implement `_announce_failure()` helper
  - Enqueue `SUB_SESSION_FAILED` to parent with error details
  - Inject system message into parent session
  - Update sub-session status → FAILED

- [x] **3C.7** Implement Redis heartbeat in the agent loop (S-12.5)
  - After each turn, refresh `bud_agent_running:{session_id}` TTL
  - Prevents false-positive zombie detection

- [x] **3C.8** Implement pending event drain in the agent loop (S-6.2)
  - After each turn, check `consume_pending_events(db, session_id)` for `SUB_SESSION_FOLLOW_UP` events
  - If found, append as user messages and continue loop
  - This handles follow-ups to persistent sessions that arrive while the task is running

- [x] **3C.9** Register the task in Celery configuration
  - Add `backend.onyx.background.celery.tasks.sub_session.tasks` to `include` list in Celery app

- [x] **3C.10** Write integration test: ONE_SHOT sub-session full lifecycle
  - Create sub-session, dispatch task
  - Verify task runs, produces result, summary is announced to parent
  - Verify sub-session status = COMPLETED
  - Verify parent session has system message with summary

- [x] **3C.11** Write integration test: sub-session timeout
  - Create sub-session with very short timeout (e.g., 5s)
  - Give it a task that takes many turns
  - Verify `SoftTimeLimitExceeded` is caught
  - Verify partial summary is announced to parent
  - Verify sub-session status = FAILED

- [x] **3C.12** Write integration test: sub-session tool execution
  - Create sub-session with `web_search` tool available
  - Verify tool is called and results are incorporated
  - Verify blocked tools (bash, spawn_sub_session) are not callable

### 3D: Zombie Reaper (S-3.5)

- [x] **3D.1** Create periodic task: `reap_zombie_sub_sessions` (runs every 60s)
  - Find `AgentSession` rows WHERE:
    - `session_type IN (SUB_ONE_SHOT, SUB_PERSISTENT)`
    - `status = ACTIVE`
    - `updated_at < now() - 15 minutes` (stale)
    - Redis key `bud_agent_running:{session_id}` does NOT exist
  - For each zombie:
    - Mark status → FAILED
    - Enqueue `SUB_SESSION_FAILED` to parent: `{ reason: "zombie_detected", partial_result: null }`
    - Inject system message into parent

- [x] **3D.2** Register in Celery Beat schedule (every 60s)

- [x] **3D.3** Write integration test: verify zombie is detected and cleaned up

---

## Phase 4: Sub-Session Tools

### 4A: Tool Implementations

- [x] **4A.1** Create `backend/onyx/agents/bud_agent/sub_session_tools.py`

- [x] **4A.2** Implement `spawn_sub_session` tool
  - Input: `{ task, task_context?, mode?, timeout_seconds?, max_turns? }`
  - Check concurrency limit via `count_active_sub_sessions()` (with lock per 0.1)
  - If at limit: return `{ status: "rejected", reason: "concurrency_limit", active_count, limit }`
  - Create sub-session via `create_sub_session()`
  - Dispatch `execute_sub_session.delay(session_id)`
  - Return `{ session_id, status: "accepted" }`
  - Validate `task_context` size (max 4K tokens, truncate if larger per S-5.5)

- [x] **4A.3** Implement `list_sub_sessions` tool
  - Input: `{ status_filter?, limit? }`
  - Query `get_sub_sessions_for_parent(db, parent_session_id)`
  - Apply status filter if provided
  - Return list of `{ session_id, task, status, session_type, created_at, tokens_used, tool_calls, turns }`

- [x] **4A.4** Implement `inspect_sub_session` tool
  - Input: `{ session_id, include_history? }`
  - Verify sub-session belongs to current user and parent matches
  - Return full session details + optionally message history

- [x] **4A.5** Implement `get_sub_session_result` tool
  - Input: `{ session_id }`
  - Verify sub-session is COMPLETED or FAILED
  - Return `{ status, summary, tokens_used, tool_calls, wall_time_seconds }`

- [x] **4A.6** Implement `cancel_sub_session` tool
  - Input: `{ session_id, reason? }`
  - Verify sub-session belongs to current user, status is ACTIVE
  - Set Redis stop flag: `bud_agent_stop:{session_id}`
  - Return `{ status: "cancelling" }` (actual cancellation is async)

- [x] **4A.7** Implement `send_to_sub_session` tool
  - Input: `{ session_id, message }`
  - Verify sub-session is `SUB_PERSISTENT` and status is `COMPLETED`
  - Enqueue `SUB_SESSION_FOLLOW_UP` event on the sub-session
  - Check Redis key `bud_agent_running:{session_id}`:
    - If NOT running: dispatch new `execute_sub_session.delay(session_id)`
    - If running: task will pick up the event after current turn (S-6.2)
  - Update sub-session status → ACTIVE
  - Return `{ status: "delivered" }`
  - Handle errors: session not found, not persistent, expired (S-6.4, S-6.5)

### 4B: Tool Registration

- [x] **4B.1** Add 6 tool names to `REMOTE_TOOLS` in `backend/onyx/agents/bud_agent/tool_definitions.py:34`
  - `spawn_sub_session`, `list_sub_sessions`, `inspect_sub_session`, `get_sub_session_result`, `cancel_sub_session`, `send_to_sub_session`

- [x] **4B.2** Register tools in `build_agent_run_context()` in `agent_context.py`
  - Import tool functions from `sub_session_tools.py`
  - Create `FunctionTool` wrappers with proper descriptions and JSON schemas
  - Add to tool list (filtered by MODE_TOOL_BLOCKLIST for sub-sessions)

### 4C: REST API Endpoints

- [x] **4C.1** Create `backend/onyx/server/agent/sub_session_api.py`

- [x] **4C.2** Implement `GET /api/agent/sessions/{session_id}/sub-sessions`
  - Return list of sub-sessions for the parent session
  - Include status, task, metrics

- [x] **4C.3** Implement `GET /api/agent/sessions/{session_id}/thread`
  - Return full message history for a sub-session (for thread panel)
  - Lazy-loaded by frontend when user opens thread

- [x] **4C.4** Implement `POST /api/agent/sessions/{session_id}/spin-off`
  - Body: `{ source_message_id, task?, mode? }`
  - Load source message + extract context (message content + tool call results)
  - Truncate `task_context` to 4K tokens (S-7.2)
  - Create sub-session, dispatch task
  - Return `{ session_id, status: "accepted" }` or rejection

- [x] **4C.5** Implement `POST /api/agent/sessions/{session_id}/cancel`
  - Set Redis stop flag for the sub-session
  - Return `{ status: "cancelling" }`

- [x] **4C.6** Implement `POST /api/agent/sessions/{session_id}/followup`
  - Body: `{ message }`
  - Same logic as `send_to_sub_session` tool but triggered from frontend

- [x] **4C.7** Register router in the FastAPI app

### 4D: Tool Tests

- [x] **4D.1** Integration test: spawn + execute + announce full cycle via tool call
- [x] **4D.2** Integration test: concurrency limit enforcement (spawn 10, reject 11th)
- [x] **4D.3** Integration test: cancel running sub-session
- [x] **4D.4** Integration test: list and inspect sub-sessions
- [x] **4D.5** Integration test: send follow-up to persistent sub-session
- [x] **4D.6** Integration test: send follow-up to ONE_SHOT returns error
- [x] **4D.7** Integration test: spin-off from user message
- [x] **4D.8** Integration test: spin-off from agent message with tool results

---

## Phase 5: Socket.IO Events

- [x] **5.1** Add Socket.IO event emitters in `backend/onyx/server/agent/socketio_server.py`
  - `agent:sub_session_spawned` → `{ session_id, child_session_id, task, mode }`
  - `agent:sub_session_progress` → `{ child_session_id, turns_completed, tokens_used }`
  - `agent:sub_session_complete` → `{ session_id, child_session_id, task, status, summary }`
  - `agent:sub_session_failed` → `{ child_session_id, error_type, partial_result }`

- [x] **5.2** Create helper: `emit_sub_session_event(parent_session_id, event_name, data)`
  - Emits to Socket.IO room `session:{parent_session_id}`
  - Called from Celery task via Redis pub/sub bridge (Celery workers don't hold Socket.IO connections)

- [x] **5.3** Add Redis pub/sub → Socket.IO bridge for sub-session events
  - Celery task publishes to Redis channel `sub_session_events:{parent_session_id}`
  - Socket.IO server subscribes and re-emits to the room
  - Pattern: same as existing `cron_status_change` and `session_message` events

- [x] **5.4** Emit `agent:sub_session_spawned` from `spawn_sub_session` tool after dispatch

- [x] **5.5** Emit `agent:sub_session_progress` from `execute_sub_session` task after each turn

- [x] **5.6** Emit `agent:sub_session_complete` from `_summarize_and_announce()` helper

- [x] **5.7** Emit `agent:sub_session_failed` from `_announce_failure()` and `_summarize_partial_and_announce()`

- [x] **5.8** Write integration test: verify Socket.IO events are emitted at correct lifecycle points

---

## Phase 6: Compaction & Session Lifecycle Integration

- [x] **6.1** Update `compact_session()` in `backend/onyx/agents/bud_agent/agent_context.py:601`
  - After creating new session, call `repoint_sub_sessions_parent(db, old_session_id, new_session_id)` (per decision 0.2)

- [x] **6.2** Update `create_session()` in `backend/onyx/db/agent.py:43`
  - In `_deactivate_user_sessions()`, after deactivating old sessions:
    - Call `repoint_sub_sessions_parent(db, old_session_id, new_session_id)` (per decision 0.3)

- [x] **6.3** Write integration test: compaction re-points sub-sessions
  - Create main session + active sub-session
  - Trigger compaction
  - Verify sub-session's `parent_session_id` now points to new session
  - Verify sub-session result arrives at new session

- [x] **6.4** Write integration test: new session re-points sub-sessions
  - Create main session + active sub-session
  - Create new session ("New Chat")
  - Verify sub-session continues and result goes to new session

---

## Phase 7: Persistent Mode Backend

- [x] **7.1** Implement inactivity expiry periodic task: `expire_persistent_sub_sessions`
  - Find `SUB_PERSISTENT` sessions WHERE status=COMPLETED AND `completed_at + 3600s < now()`
  - Keep them as COMPLETED (no status change needed — they're already complete)
  - Enqueue `AgentSessionEvent` to parent: "Persistent session '{task}' expired."
  - Set a flag (`expired=True` or just check timestamp) so `send_to_sub_session` rejects follow-ups

- [x] **7.2** Register in Celery Beat schedule (every 5 minutes)

- [x] **7.3** Update `send_to_sub_session` tool to check expiry
  - If `completed_at + inactivity_timeout < now()`: return `{ status: "error", reason: "session_expired" }`

- [x] **7.4** Write integration test: persistent session follow-up full cycle
  - Spawn persistent sub-session → completes → send follow-up → produces new result

- [x] **7.5** Write integration test: persistent session expiry
  - Spawn persistent sub-session → completes → wait past inactivity timeout → send follow-up → rejected

- [x] **7.6** Write integration test: follow-up while sub-session is still running (S-6.2)
  - Spawn persistent sub-session with long task
  - While running, send follow-up
  - Verify follow-up is queued and processed after current turn

- [x] **7.7** Write integration test: multiple rapid follow-ups (S-6.3)
  - Send 3 follow-ups quickly
  - Verify all 3 are processed in order

---

## Phase 8: Frontend — Data Layer

### 8A: Types & Models

- [x] **8A.1** Add sub-session types to `web/src/app/chat/services/streamingModels.ts`
  - `SubSessionSpawnedObj`, `SubSessionProgressObj`, `SubSessionCompleteObj`, `SubSessionFailedObj`
  - Add to `ObjTypes` union

- [x] **8A.2** Create sub-session TypeScript interfaces in a new types file or in `AgentSessionContext.tsx`
  ```typescript
  SubSessionSummary { session_id, parent_session_id, task, status, session_type, mode, created_at, completed_at, turns_completed, tokens_used, tool_calls }
  ThreadMessage { id, role, content, timestamp, tool_calls? }
  ```

- [x] **8A.3** Extend `AgentSession` interface in `AgentSessionContext.tsx`
  - Add: `session_type`, `parent_session_id`, `task_description`

### 8B: useSubSessions Hook

- [x] **8B.1** Create `web/src/lib/desktop/useSubSessions.ts`
  - State: `subSessions: SubSessionSummary[]` (for current parent session)
  - On mount: fetch `GET /api/agent/sessions/{parentId}/sub-sessions`
  - Socket.IO listeners:
    - `agent:sub_session_spawned` → add to list
    - `agent:sub_session_progress` → update turns_completed, tokens_used
    - `agent:sub_session_complete` → update status to completed
    - `agent:sub_session_failed` → update status to failed
  - Expose: `subSessions`, `activeCount`, `completedCount`, `spawnSubSession()`, `cancelSubSession()`

- [x] **8B.2** Add Socket.IO event listeners in `web/src/lib/desktop/useAgentSocket.ts`
  - Listen for `agent:sub_session_spawned`, `agent:sub_session_progress`, `agent:sub_session_complete`, `agent:sub_session_failed`
  - Forward to `useSubSessions` callbacks

### 8C: useSubSessionThread Hook

- [x] **8C.1** Create `web/src/lib/desktop/useSubSessionThread.ts`
  - State: `messages: ThreadMessage[]`, `isLoading: boolean`, `session: SubSessionSummary | null`
  - `openThread(sessionId)` → fetch `GET /api/agent/sessions/{sessionId}/thread`
  - Listen for `agent:sub_session_progress` → re-fetch messages (delta) for the open thread
  - `closeThread()` → clear state
  - `sendFollowUp(message)` → `POST /api/agent/sessions/{sessionId}/followup`
  - `cancel()` → `POST /api/agent/sessions/{sessionId}/cancel`

---

## Phase 9: Frontend — UI Components

### 9A: SubSessionCard + CardGroup

- [x] **9A.1** Create `web/src/components/desktop/sub-sessions/SubSessionCard.tsx`
  - Props: `SubSessionSummary`, `onClick`
  - Display: status icon (spinner/checkmark/X/clock), task (truncated 1 line), progress text (turns, tokens)
  - Click handler → opens thread panel

- [x] **9A.2** Create `web/src/components/desktop/sub-sessions/SubSessionCardGroup.tsx`
  - Props: `subSessions: SubSessionSummary[]`, `onCardClick`
  - Renders a vertical stack of `SubSessionCard` components
  - Anchored to the spawning message in the main chat

- [x] **9A.3** Integrate `SubSessionCardGroup` into `BudAgentScreen.tsx` message list
  - After agent messages that spawned sub-sessions, render the card group
  - Determine which messages spawned sub-sessions by matching `agent:sub_session_spawned` events to message indices

### 9B: SubSessionThreadPanel

- [x] **9B.1** Create `web/src/components/desktop/sub-sessions/SubSessionThreadPanel.tsx`
  - Right-side drawer (same pattern as artifact panel, ~30rem width)
  - Header: back button, task title, status badge, metrics (turns, tokens, wall time)
  - Body: scrollable message list (system, assistant, tool calls)
  - Footer:
    - Cancel button (if status = ACTIVE)
    - Follow-up input (if session_type = SUB_PERSISTENT and status = COMPLETED)
  - Loading state: spinner while fetching thread
  - Empty state: "Working..." with spinner (before first turn completes)

- [x] **9B.2** Integrate into `BudAgentScreen.tsx`
  - Add as right-side panel (same slot as artifact panel — mutually exclusive)
  - Open via card click or status bar dropdown click
  - Close via back button or clicking outside

- [x] **9B.3** Handle panel updates when sub-session completes new turns
  - Listen for `agent:sub_session_progress` for the currently viewed sub-session
  - Re-fetch thread messages (or append delta)

### 9C: SubSessionStatusBar

- [x] **9C.1** Create `web/src/components/desktop/sub-sessions/SubSessionStatusBar.tsx`
  - Displays at top of message area (above messages, below header)
  - Shows: active count, completed count (within last 5 min)
  - "View all" button opens dropdown
  - Hidden when no sub-sessions are active or recently completed

- [x] **9C.2** Create `web/src/components/desktop/sub-sessions/SubSessionListDropdown.tsx`
  - Dropdown listing all sub-sessions with status, task, timestamps
  - Click item → opens thread panel
  - Scrollable for many items

- [x] **9C.3** Integrate `SubSessionStatusBar` into `BudAgentScreen.tsx`
  - Render at top of messages container

### 9D: SubSessionSpinOffDialog

- [x] **9D.1** Create `web/src/components/desktop/sub-sessions/SubSessionSpinOffDialog.tsx`
  - Triggered by message context menu: "Spin off as sub-session"
  - Pre-filled task: source message content (editable textarea)
  - Mode selector: ONE_SHOT (default) / PERSISTENT (radio buttons)
  - "Start" button → calls `POST /api/agent/sessions/{parentId}/spin-off`
  - Error state: shows rejection message if concurrency limit hit
  - Loading state: spinner on Start button while creating

- [x] **9D.2** Add context menu item to messages in `BudAgentScreen.tsx`
  - Show "Spin off as sub-session" for user and assistant messages only (not system messages, S-7.4)
  - Do NOT show in thread panel messages (no nested spin-off, S-7.5)

### 9E: Completion Divider

- [x] **9E.1** Create completion divider component
  - Renders inline in main chat: `── ✅ {task} completed ──` or `── ❌ {task} failed ──`
  - Appears when sub-session completes (triggered by `agent:sub_session_complete` or `agent:sub_session_failed`)

- [x] **9E.2** Integrate into message list rendering in `BudAgentScreen.tsx`

---

## Phase 10: Frontend Integration & Polish

- [x] **10.1** Handle reconnection: on `agent:rejoin`, re-fetch sub-session list from API (S-9.2)
- [x] **10.2** Handle backgrounded tab: verify state is correct when tab is foregrounded (S-9.3)
- [x] **10.3** Ensure only one panel is open at a time (thread panel vs. artifact panel vs. sources sidebar) (S-8.4)
- [x] **10.4** Handle compaction: when `agent:session_compacted` fires, update sub-session parent references in local state (S-8.5)
- [x] **10.5** Thread panel survives compaction (viewing sub-session is independent of main session, S-8.5)
- [x] **10.6** Status bar disappears correctly when no sub-sessions are active/recent (S-8.6)
- [x] **10.7** Cards scrolled out of view: completion divider + status bar still inform user (S-8.7)

---

## Phase 11: SSE Endpoint Cleanup (Prerequisite Unblock)

This phase removes the deprecated SSE endpoint and associated dead code, unblocking arch-v2 Phase 3 cleanup. Can be done in parallel with any phase above.

- [x] **11.1** Delete SSE endpoint `POST /sessions/{session_id}/execute` from `backend/onyx/server/agent/api.py` (~lines 810-853)
- [x] **11.2** Delete `POST /sessions/{session_id}/tool-result` from `api.py` (~lines 858-897)
- [x] **11.3** Delete `POST /sessions/{session_id}/approval` from `api.py` (~lines 902-938)
- [x] **11.4** Delete `BudAgentOrchestrator` class — remove `backend/onyx/agents/bud_agent/orchestrator.py` (904 lines)
- [x] **11.5** Delete `LocalToolBridge` class — remove `backend/onyx/agents/bud_agent/local_tool_bridge.py`
- [x] **11.6** Delete frontend SSE hook — remove `web/src/lib/desktop/useAgentSSE.ts`
- [x] **11.7** Delete frontend SSE proxy route — remove `web/src/app/api/local-agent/execute/route.ts`
- [x] **11.8** Clean up any remaining imports of deleted modules
- [x] **11.9** Verify all tests pass after deletion

---

## Phase 12: End-to-End Tests

### Playwright E2E Tests

- [x] **12.1** E2E: Spawn sub-session from interactive chat
  - Send a message that triggers agent to spawn a sub-session
  - Verify sub-session card appears inline
  - Verify card status updates (spinner → checkmark) on completion
  - Verify completion divider and summary appear in main chat

- [x] **12.2** E2E: Open and navigate thread panel
  - Click sub-session card
  - Verify thread panel slides in with full conversation
  - Verify panel updates as sub-session completes turns
  - Click back button → panel closes

- [x] **12.3** E2E: Cancel sub-session from thread panel
  - Open thread panel for active sub-session
  - Click Cancel
  - Verify card updates to cancelled state
  - Verify partial result notification in main chat

- [x] **12.4** E2E: User-initiated spin-off
  - Right-click a message → "Spin off as sub-session"
  - Edit task in dialog, select mode, click Start
  - Verify new card appears anchored to source message
  - Verify sub-session executes and announces result

- [x] **12.5** E2E: Status bar interaction
  - Spawn 3 sub-sessions
  - Verify status bar shows "3 active"
  - Click "View all" → dropdown shows all 3
  - Click one → thread panel opens

- [x] **12.6** E2E: Persistent sub-session follow-up
  - Spawn persistent sub-session → wait for completion
  - Open thread panel → type follow-up → send
  - Verify sub-session resumes and produces new result
  - Verify result appears in main chat

- [x] **12.7** E2E: Concurrency limit rejection
  - Spawn 10 sub-sessions (may need to mock for speed)
  - Attempt 11th → verify agent reports rejection
  - Cancel one → retry → verify success

---

## Task Summary

| Phase | Tasks | Key Deliverable |
|-------|-------|----------------|
| **0** | 6 | Design decisions documented |
| **1A** | 5 | AgentSessionEvent model + CRUD |
| **1B** | 10 | session_type column + DB helpers |
| **2** | 6 | Event queue consumer in AgentHandler |
| **3A** | 3 | SubSessionEmitter + AutoApproveRequester |
| **3B** | 4 | SUB_SESSION execution mode |
| **3C** | 12 | Celery task (core engine) |
| **3D** | 3 | Zombie reaper |
| **4A** | 7 | 6 agent tools |
| **4B** | 2 | Tool registration |
| **4C** | 7 | REST API endpoints |
| **4D** | 8 | Tool integration tests |
| **5** | 8 | Socket.IO events |
| **6** | 4 | Compaction + session lifecycle |
| **7** | 7 | Persistent mode |
| **8A** | 3 | Frontend types |
| **8B** | 2 | useSubSessions hook |
| **8C** | 1 | useSubSessionThread hook |
| **9A** | 3 | Cards + card group |
| **9B** | 3 | Thread panel |
| **9C** | 3 | Status bar + dropdown |
| **9D** | 2 | Spin-off dialog |
| **9E** | 2 | Completion divider |
| **10** | 7 | Frontend integration polish |
| **11** | 9 | SSE cleanup |
| **12** | 7 | Playwright E2E tests |
| **Total** | **127** | |

### Parallelization Opportunities

```
Phase 0 (decisions)
  ↓
Phase 1A ─────────┐
Phase 1B ─────────┼── can run in parallel
Phase 3A ─────────┘
  ↓
Phase 2 (needs 1A)
Phase 3B (needs 1B)
  ↓
Phase 3C (needs 1A + 1B + 3A + 3B)
Phase 3D (needs 3C)
  ↓
Phase 4 (needs 3C)
Phase 5 (needs 2 + 3C)
Phase 6 (needs 1B + 3C)
Phase 7 (needs 4)
  ↓
Phase 8 (needs 5)       ← frontend starts
Phase 9 (needs 8)
Phase 10 (needs 9)
  ↓
Phase 12 (needs all)

Phase 11 (SSE cleanup) ← independent, anytime
```
