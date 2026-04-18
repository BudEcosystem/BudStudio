# Orchestrator Unification — Tasks

Plan: [orchestrator-unification.md](orchestrator-unification.md)

## Current Phase: Phase 1 — Extract Shared Components

New files alongside existing code. Non-breaking — nothing changes for production.

---

### 1.1 `llm_turn.py` — per-turn LLM streaming core

- [x] Create `backend/onyx/agents/bud_agent/llm_turn.py`
- [x] `TurnCallbacks` dataclass — `on_reasoning_start`, `on_reasoning_delta`, `on_text_start`, `on_text_delta`, `on_section_end`, `on_tool_call`, `should_stop`
- [x] `TurnResult` dataclass — `full_response_text`, `thinking_content`, `tool_calls`, `tool_call_count`, `final_messages`, `stopped`
- [x] `ToolCallInfo` dataclass — `name`, `input`, `call_id`, `raw_item`
- [x] `run_llm_turn()` — async: `Runner.run_streamed()`, classify events, invoke callbacks, return `TurnResult`
- [x] `_extract_tool_name()`, `_extract_call_id()`, `_extract_tool_input()` — port from `agent_handler.py:1074-1091`
- [x] Tests: `backend/tests/unit/onyx/agents/bud_agent/test_llm_turn.py`
  - [x] Mock `Runner.run_streamed()` with synthetic events
  - [x] `TurnResult` accumulates text + thinking + tool calls
  - [x] `should_stop` → early exit, `stopped=True`
  - [x] Callbacks fire in correct order
  - [x] `on_section_end` fires on reasoning→text transition
  - [x] Tool extraction handles both attribute and dict formats

Port from: `agent_handler.py:960-1103`, `agent_context.py:698-731`, `orchestrator.py:528-616`

---

### 1.2 `citation_processor.py` — extract duplicated citation logic

- [x] Create `backend/onyx/agents/bud_agent/citation_processor.py`
- [x] `CitationProcessor.__init__(search_context)` — regex patterns, buffer, emitted doc IDs
- [x] `active` property — `search_context.should_cite`
- [x] `process_token(token)` → `(processed_text, list[CitationInfo])`
- [x] `flush()` → drain remaining buffer
- [x] `build_ui_spec()` → citation + search_docs metadata for DB
- [x] Tests: `backend/tests/unit/onyx/agents/bud_agent/test_citation_processor.py`
  - [x] `[1]` → `[[1]](link)`
  - [x] `[[1]]` passthrough
  - [x] `[1, 2, 3]` multi-citation
  - [x] Partial buffering (`[` held, `1]` completes)
  - [x] `flush()` drains partial
  - [x] `build_ui_spec()` correct metadata
  - [x] Empty search context → `active=False`, text unchanged

Port from: `orchestrator.py:413-493,703-745`, `agent_handler.py:1469-1535`

---

### 1.3 `persist_turn_result()` helper

- [x] Add to `backend/onyx/agents/bud_agent/agent_context.py`
- [x] `persist_turn_result(db_session, session_id, response_text, thinking_content, tool_call_count, step_number, ui_spec)`
- [x] Test: calls `add_session_message` + `update_session_stats` correctly

Replaces inline code in: `orchestrator.py:694-768`, `agent_handler.py:1134-1151`, `cron_orchestrator.py:191-203`, `inbox_orchestrator.py:191-203`

---

### 1.4 `turn_driver.py` — unified state machine

- [x] Create `backend/onyx/agents/bud_agent/turn_driver.py`
- [x] `TurnEmitter` protocol — `reasoning_start`, `reasoning_delta`, `text_start`, `text_delta`, `section_end`, `tool_start`
- [x] `ToolRequester` protocol — `request(tool)`
- [x] `TurnDriverConfig` — `mode`, `max_tool_calls`, `should_stop`, `emitter`, `tool_requester`, `on_turn_complete`
- [x] `TurnDriverResult` — `status`, `turn`, `pending`
- [x] `TurnDriver.run_next_turn()` — one LLM turn, persist, classify tools, recurse or return
- [x] `TurnDriver.handle_tool_result()` — persist result, check pending, dispatch next or new turn
- [x] `classify_tool_calls()` — via `is_local_tool()`, `requires_approval()`
- [x] Tests: `backend/tests/unit/onyx/agents/bud_agent/test_turn_driver.py`
  - [x] Remote-only → recurse → `status="complete"`
  - [x] Local tool → save pending → `status="awaiting_tool"`
  - [x] `handle_tool_result` + remaining pending → dispatch next
  - [x] `handle_tool_result` + none remaining → next LLM turn
  - [x] Max tool calls → `status="max_tools_reached"`
  - [x] `should_stop` → `status="stopped"`
  - [x] `on_turn_complete` fires each turn

---

### 1.5 `socketio_emitter.py` — Socket.IO protocol implementations

- [x] Create `backend/onyx/server/agent/socketio_emitter.py`
- [x] `SocketIOEmitter(TurnEmitter)`
  - [x] `__init__(sio, session_id, search_context)` — sio ref, `CitationProcessor`
  - [x] `text_delta` — process citations, emit `agent:message_delta`
  - [x] `reasoning_start/delta`, `text_start`, `section_end`, `tool_start` — emit events
- [x] `SocketIOToolRequester(ToolRequester)`
  - [x] `__init__(sio, session_id, always_allowed_tools, connector_approval_tools, connector_gateway_map)`
  - [x] `request(tool)` — emit `tool:approval_required` or `tool:request`
- [x] Tests:
  - [x] Mock `sio.emit`, verify events for text/reasoning/tool
  - [x] Approval-required tools → `tool:approval_required`

Port from: `agent_handler.py:940-1340`

---

### 1.6 Move `LLM_HIDDEN_LOCAL_TOOLS`

- [x] Add `LLM_HIDDEN_LOCAL_TOOLS` set to `tool_definitions.py`
- [x] Update `local_tool_bridge.py` to import from `tool_definitions`
- [x] Update `agent_handler.py` import if needed

---

## Phase 2: Wire Up — Replace Existing Orchestrators

Depends on Phase 1. Each task modifies one execution path. Deploy and validate incrementally.

---

### 2.1 Wire up interactive (`agent_handler.py`)

Replace `_stream_and_handle()` (~400 lines) and inline tool dispatch with `TurnDriver`.

- [x] Refactor `handle_execute()` — create `TurnDriver` with `SocketIOEmitter` + `SocketIOToolRequester`, call `driver.run_next_turn()`, handle result status
- [x] Refactor `handle_tool_result()` — kept inline pending dispatch (complex approval/connector logic); calls `_run_llm_turn()` (which uses TurnDriver) when all pending done
- [x] Refactor `handle_approval()` — approved: execute connector or delegate to `TurnDriver`; denied: persist error, call `driver.run_next_turn()`
- [x] Delete `_stream_and_handle()` (~400 lines)
- [x] Delete `_process_citation_token()` static method (~70 lines)
- [x] Delete `_handle_compaction()` — kept as pre-turn check in `_run_llm_turn()`
- [x] Delete inline tool classification/dispatch logic (lines 1163-1341) — replaced by TurnDriver.classify_tool_calls()
- [x] Ensure local tool stubs respect `LLM_HIDDEN_LOCAL_TOOLS` from `tool_definitions.py`
- [x] Keep `handle_stop()`, `handle_file_sync()` unchanged
- [ ] Integration test: user message → LLM response → `agent:message_delta` events
- [ ] Integration test: tool call → `tool:request` → `tool:result` → next turn
- [ ] Integration test: citation rendering in streamed response
- [ ] Integration test: `agent:stop` mid-stream → `agent:stopped`
- [ ] Deploy to `chat-dev`, validate manually

---

### 2.2 Wire up cron (`cron_orchestrator.py`)

Replace `run_sync_agent_loop()` + suspension hack with `TurnDriver`.

- [x] Refactor `run()` — create `TurnDriver` with `emitter=None, tool_requester=None`, call `_run_async(driver.run_next_turn(...))`, map `TurnDriverResult.status` to `CronRunResult`
- [x] Refactor `resume()` — create `TurnDriver`, call `_run_async(driver.handle_tool_result(...))`, same status mapping, remove message reconstruction
- [x] Delete `_create_local_tool_stubs()` (~60 lines)
- [x] Delete `_create_suspension_tool()` (~40 lines)
- [x] Keep `_apply_post_llm_skip_checks()` — applied after driver result, not as on_turn_complete
- [x] Keep `CronRunResult` dataclass (API contract with Celery task)
- [x] Update `execute_agent_cron_job()` in `tasks/agent_cron/tasks.py` — messages=[] in suspend_cron_execution, TurnDriver saves pending to AgentSession
- [x] Update `resume_agent_cron_execution()` in `tasks/agent_cron/tasks.py` — simplified: removed `suspended_messages` loading, uses TurnDriver.handle_tool_result()
- [ ] Integration test: cron with remote-only tools runs to completion
- [ ] Integration test: cron with local tool → `awaiting_tool` → resume → completion
- [ ] Integration test: cron with NO_ACTION_NEEDED skip
- [ ] Integration test: cron with dedup skip

---

### 2.3 Wire up inbox (`inbox_orchestrator.py`)

Replace `run_sync_agent_loop()` with `TurnDriver`.

- [x] Refactor `run()` — create `TurnDriver` with `emitter=None, tool_requester=None`, `should_stop=lambda: result.replied or result.awaiting_user`, call `_run_async(driver.run_next_turn(...))`
- [x] Map `TurnDriverResult.status` to `InboxRunResult` fields
- [x] Keep `_tracked_send_message`, `_tracked_escalate_to_user` tool wrappers
- [x] Keep `InboxRunResult` dataclass
- [ ] Integration test: inbox → reply → `result.replied == True`
- [ ] Integration test: inbox → escalate → `result.awaiting_user == True`
- [ ] Integration test: inbox → no action → `result.no_action == True`

---

## Phase 3: Clean Up — Delete Deprecated Code

Depends on Phase 2. Only after all modes validated on `TurnDriver`.

---

### 3.1 Delete `orchestrator.py`

**Blocked**: `api.py` SSE endpoint still imports `BudAgentOrchestrator`. Delete after SSE endpoint is removed.

- [x] `grep -r "BudAgentOrchestrator\|from onyx.agents.bud_agent.orchestrator" backend/` — only `api.py` (SSE legacy) and `local_tool_bridge.py` (used by orchestrator)
- [ ] Verify all references are dead code or updated
- [ ] Delete `backend/onyx/agents/bud_agent/orchestrator.py`
- [ ] Remove/update any remaining imports

---

### 3.2 Delete `local_tool_bridge.py`

**Blocked**: only used by `orchestrator.py` which is blocked on 3.1.

- [x] `grep -r "LocalToolBridge\|from onyx.agents.bud_agent.local_tool_bridge" backend/` — only `orchestrator.py`
- [x] Verify `LLM_HIDDEN_LOCAL_TOOLS` already in `tool_definitions.py` (task 1.6)
- [ ] Delete `backend/onyx/agents/bud_agent/local_tool_bridge.py`
- [ ] Remove/update any remaining imports

---

### 3.3 Remove `run_sync_agent_loop()` from `agent_context.py`

- [x] `grep -r "run_sync_agent_loop\|SyncLoopResult" backend/` — zero production references
- [x] Delete `run_sync_agent_loop()` and `SyncLoopResult` from `agent_context.py`
- [x] Remove unused imports: `SyncAgentStream`, `RawResponsesStreamEvent`, `ToolCallItem`, `cast`

---

### 3.4 DB migration: remove cron suspension fields

**Only after 2.2 is deployed and validated.**

- [ ] Create `backend/alembic/versions/xxxx_remove_cron_suspension_fields.py` — remove `suspended_tool_name`, `suspended_tool_input`, `suspended_tool_call_id`, `suspended_messages` from `agent_cron_execution`
- [ ] Remove the four fields from `AgentCronExecution` in `backend/onyx/db/models.py`
- [ ] Remove `suspend_cron_execution()`, `clear_suspension_state()` from `backend/onyx/db/agent_cron.py`

---

### 3.5 Final cleanup

- [x] `grep -r` for all imports from deleted files — verified
- [ ] `pre-commit run --all-files`
- [ ] Full integration test suite
