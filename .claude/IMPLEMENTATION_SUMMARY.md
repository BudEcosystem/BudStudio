# CLI Agent Tool Implementation Summary

## Overview
Successfully implemented the `cli_agent` tool for BudAgent as a non-blocking, autonomous sub-agent spawner for Codex CLI with automatic callback-based resume on completion.

## Completed Implementation

### 1. Frontend: CLI Agent Tool (`web/src/lib/agent/tools/cli-agent-tool.ts`) ✅

**New File** with CliAgentTool class implementing the Tool interface.

**Parameters:**
| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| `prompt` | string | yes | — | Task to give codex |
| `working_directory` | string | no | workspacePath | Absolute path on machine |
| `model` | string | no | — | Override model (e.g. `"o3"`) |
| `sandbox` | enum | no | `"workspace-write"` | `"read-only"`, `"workspace-write"`, `"danger-full-access"` |
| `skip_git_check` | boolean | no | false | Skip git repo check |
| `ephemeral` | boolean | no | true | Persist session after completion |

**Execution Flow:**
1. Validate prompt (non-empty)
2. Resolve working_directory (must exist via `fs.existsSync`)
3. Validate git repo (unless `skip_git_check=true`)
4. Build codex command with sandbox flags and escaped prompt
5. Spawn via `ProcessRegistry.getInstance().spawn(command, cwd, { pty: true, env: createShellEnv() })`
6. Register `onSessionComplete` callback via `registerOnExit()`
7. Return immediately: `"Codex agent started in session {sessionId}..."`

**Key Features:**
- POSIX shell escaping for prompt: `'...'` wrapping with `'` → `'\''`
- Proper sandbox flag mapping
- Callback-based completion notification
- PTY-enabled for interactive codex experience

### 2. Frontend: ProcessRegistry Enhancements (`web/src/lib/agent/tools/process-registry.ts`) ✅

**Added Callback Support:**
- Added `onExitCallbacks: Array<(output: string, exitCode: number | null) => void>` to ProcessSession interface
- Initialized `onExitCallbacks: []` in spawn() method
- Added public `registerOnExit(sessionId, callback)` method:
  - Finds session, throws if not found
  - If already finished: calls callback immediately with aggregatedOutput and exitCode
  - If running: queues callback in onExitCallbacks array
- Flush callbacks in 3 places when process exits:
  - `spawnPtySession()` → `handle.onExit()` handler
  - `spawnChildSession()` → `proc.on("close")` handler
  - `spawnChildSession()` → `proc.on("error")` handler

### 3. Backend: Event Publisher (`backend/onyx/redis/event_publisher.py`) ✅

**Updated:**
- Added `"resume_execute"` to the `event_type` Literal union at line 37

```python
event_type: Literal[
    "session_message",
    "inbox_message",
    "inbox_status_change",
    "cron_status_change",
    "resume_execute",  # NEW
]
```

### 4. Backend: Event Publishing Endpoint (`backend/onyx/server/agent/api.py`) ✅

**Added Route:** `POST /agent/events/publish`

**Request Body:**
```python
class PublishEventRequest(BaseModel):
    event_type: str
    data: dict[str, Any]
```

**Handler:**
- Extracts current_user via `@Depends(current_user)`
- Gets tenant_id from context
- Calls `publish_event(tenant_id, current_user.id, event_type, data)`
- Returns `{"status": "ok"}`

**Purpose:** Allows Node.js server to publish events to Redis/SSE stream since Node.js cannot call Redis directly.

### 5. Frontend: Background Completion Route (`web/src/app/api/local-agent/background-complete/route.ts`) ✅

**New File:** Callback endpoint for codex completion.

**Endpoint:** `POST /api/local-agent/background-complete`

**Request Body:**
```typescript
{
  budSessionId: string;
  output: string;
  exitCode: number | null;
}
```

**Handler Logic:**
1. Extract cookies for authentication
2. POST to backend `/agent/events/publish` with:
   - `event_type: "resume_execute"`
   - `data`: { `session_id`, `message: "Codex has finished (exit code: {N}). Output:\n\n{output}..."` }
3. Return `{ status: "ok" }`

**Bridge Function:** Translates Node.js process completion to backend event stream.

### 6. Frontend: Local Execution Registry (`web/src/lib/agent/tools/local-execution.ts`) ✅

**Updated Signature:**
```typescript
export async function createLocalToolRegistry(
  workspacePath: string,
  budSessionId?: string,       // NEW: BudAgent session for callbacks
  apiBaseUrl?: string,         // NEW: backend URL for posting events
  cookieString?: string        // NEW: auth cookies
): Promise<ToolRegistry>
```

**Added Callback Wiring:**
- When `budSessionId` and `apiBaseUrl` provided, creates `onSessionComplete` callback
- Callback POSTs to `/api/local-agent/background-complete` with codex output
- Passed to CliAgentTool constructor
- Enables non-blocking background execution with auto-resume

### 7. Frontend: Tool Catalog (`web/src/lib/agent/tools/tool-catalog.ts`) ✅

**Added cli_agent Entry:**
```typescript
{
  name: "cli_agent",
  description: "Spawn Codex CLI as autonomous sub-agent...",
  category: "local",
  requiresApproval: true,
  parameters: [
    { name: "prompt", type: "string", required: true, ... },
    { name: "working_directory", type: "string", required: false, ... },
    { name: "model", type: "string", required: false, ... },
    {
      name: "sandbox",
      type: "string",
      required: false,
      enum: ["read-only", "workspace-write", "danger-full-access"]
    },
    { name: "skip_git_check", type: "boolean", required: false, ... },
    { name: "ephemeral", type: "boolean", required: false, ... },
  ]
}
```

**Updated Tool Parameters Interface:**
- Added optional `enum?: string[]` field to ToolParameter

### 8. Frontend: Execute Route (`web/src/app/api/local-agent/execute/route.ts`) ✅

**Updated Registry Creation Call:**
```typescript
const registry = await createLocalToolRegistry(
  resolvedWorkspacePath,
  sessionId,       // for cli_agent to call back
  apiBaseUrl,      // for cli_agent callback to POST to
  cookieString     // for authentication in callback
);
```

### 9. Frontend: Agent Session Context (`web/src/components/desktop/AgentSessionContext.tsx`) ✅

**Updated AgentSessionContextType:**
- Added `executeRef: React.MutableRefObject<((params: AgentExecuteParams, callbacks: AgentEventCallbacks) => Promise<void>) | null>`

**Added resume_execute Handler:**
- Registers handler for `"resume_execute"` event
- Extracts `session_id` and `message` from event data
- Switches to target session if needed
- Calls `executeRef.current()` with completion message
- Graceful error handling with logging

**Initialization:**
- Created ref: `const executeRef = useRef<...>(null)`
- Exposed in context value

### 10. Frontend: BudAgent Screen (`web/src/components/desktop/BudAgentScreen.tsx`) ✅

**Wired Execute Function:**
```typescript
const { executeRef } = useAgentSession();
useEffect(() => {
  executeRef.current = execute;
  return () => { executeRef.current = null; };
}, [execute, executeRef]);
```

Ensures context's executeRef always points to current execute function.

## Complete Flow: End-to-End

```
1. User: "Use codex to add a README.md"
   ↓
2. LLM calls cli_agent(prompt, ...)
   ↓
3. Frontend approves tool call
   ↓
4. cli_agent.execute() spawns codex PTY → returns "Codex started: ps_3" immediately
   ↓
5. Route calls submitToolResult("Codex started: ps_3")
   ↓
6. Backend LLM receives result, generates text: "I've delegated to Codex (session ps_3)..."
   ↓
7. agent_done → SSE closes → turn ends normally
   ↓
8. Codex runs autonomously (minutes/hours later)...
   ↓
9. ProcessRegistry.onExit fires on completion
   ↓
10. onExit callback POSTs to /api/local-agent/background-complete with output
    ↓
11. background-complete POSTs to backend /agent/events/publish
    ↓
12. Backend publishes "resume_execute" event with codex output
    ↓
13. Frontend persistent SSE receives "resume_execute"
    ↓
14. AgentSessionContext resume_execute handler fires
    ↓
15. Calls executeRef.current() with completion message
    ↓
16. New agent turn starts → LLM sees codex output → responds
    ↓
17. Final BudAgent response appears without user action
```

## Key Features

✅ **Non-blocking**: Returns immediately to agent, doesn't hold HTTP thread
✅ **Autonomous**: Codex runs in background without user waiting
✅ **Auto-resume**: New agent turn fires automatically when codex finishes
✅ **Type-safe**: Full TypeScript types throughout
✅ **Error handling**: Graceful degradation, proper logging
✅ **Security**: POSIX shell escaping, sandbox levels, approval required
✅ **Callback pattern**: Reuses existing infrastructure (ProcessRegistry, events, SSE)

## Files Modified/Created

| File | Status | Changes |
|------|--------|---------|
| `web/src/lib/agent/tools/cli-agent-tool.ts` | **NEW** | CliAgentTool class, 221 lines |
| `web/src/lib/agent/tools/process-registry.ts` | Modified | onExitCallbacks, registerOnExit(), flush on exit |
| `web/src/lib/agent/tools/index.ts` | Modified | Export CliAgentTool |
| `web/src/app/api/local-agent/background-complete/route.ts` | **NEW** | Callback endpoint, ~50 lines |
| `web/src/lib/agent/tools/local-execution.ts` | Modified | New params, callback wiring |
| `web/src/lib/agent/tools/tool-catalog.ts` | Modified | Added cli_agent entry, enum support |
| `web/src/app/api/local-agent/execute/route.ts` | Modified | Pass sessionId/apiBaseUrl/cookieString |
| `backend/onyx/redis/event_publisher.py` | Modified | Added "resume_execute" to event_type Literal |
| `backend/onyx/server/agent/api.py` | Modified | Added POST /agent/events/publish endpoint |
| `web/src/components/desktop/AgentSessionContext.tsx` | Modified | Added executeRef, resume_execute handler |
| `web/src/components/desktop/BudAgentScreen.tsx` | Modified | Wire execute into executeRef |

## Testing Strategy

**Unit Tests** — `cli-agent-tool.test.ts`, `process-registry.test.ts`:
1. Correct command strings per sandbox mode
2. PTY mode always used (pty: true)
3. Non-existent directory validation
4. Callback fires on exit
5. Ephemeral/skip_git_check flags work

**Integration Tests** — Real Codex execution:
1. Spawn with valid prompt → returns session ID immediately
2. Poll session shows "running" status
3. Codex completes → callback fires
4. background-complete POSTs successfully
5. backend /agent/events/publish receives event
6. Frontend SSE receives "resume_execute"

**E2E Tests** (Playwright):
1. Ask BudAgent: "Use codex to add README.md"
2. Approve cli_agent tool call
3. Verify BudAgent response includes session ID
4. Wait for codex to finish
5. Verify new agent turn fires automatically
6. Verify final response appears

## Notes for Verification

- All TypeScript compiles with no errors
- Tool integrates into existing registry pattern
- Callback mechanism reuses ProcessRegistry infrastructure
- Event publishing follows existing backend patterns
- SSE event stream already supports custom events
- No breaking changes to existing tools or APIs

## Configuration Required

None. The tool uses:
- Existing ProcessRegistry for process management
- Existing event publishing infrastructure
- Existing SSE stream for frontend notifications
- Standard codex CLI (assumed available in PATH)

All callback URLs and endpoints auto-discovered from request context.

---

**Implementation completed successfully.** All 10 major components implemented in parallel using 5 subagents. Ready for testing.
