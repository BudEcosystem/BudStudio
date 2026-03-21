# Skill Evolution & Automated Canvas Flow — Research Synthesis

## Objective

Design the best structure for:
1. **Automated Canvas flow** (skill creation from workflow patterns)
2. **Discovery** of relevant skills from agent conversations
3. **Skill updates** (per-box feedback, edge-based feedback, new node feedback, skill-to-skill connections)
4. **Flow-to-flow connections** (skill composition & chaining)

---

## 1. Key Frameworks Studied

### EvoSkill (Sentient AGI)
**Core idea:** Evolutionary self-improvement for AI agents. Treats agent configs as "programs," skills/prompts as "genes," benchmark performance as "fitness."

**Architecture:**
```
[Base Agent] → [Test on failures] → [Skill Proposer] → [Skill Generator] → [Evaluate] → [Frontier Selection]
                                          ↑                                       |
                                          └── feedback_history.md ←───────────────┘
```

**Key patterns:**
- **Skills as Markdown:** `.claude/skills/<name>/SKILL.md` with YAML frontmatter (name, description, instructions) + optional scripts/references/assets
- **Evolutionary loop:** Propose → Generate → Evaluate → Select (keep top-N "frontier")
- **Feedback history:** Accumulated markdown file recording proposal → outcome (IMPROVED/DISCARDED) + score delta + active skills. Passed as context to each proposer iteration
- **Skill proposer actions:** `create` (new skill) or `edit` (modify existing skill) — prefers edit over create
- **Git-as-database:** Each program variant = git branch. Tags for frontier. YAML for config. Content-hash caching
- **No explicit skill graph:** Connections are implicit via feedback history + directory scanning
- **Proposer/Generator separation (two-agent pipeline):** Proposer *diagnoses* failures and decides what to change; Generator *implements* the change. 5 specialized agents total: Base Agent, Skill Proposer, Prompt Proposer, Skill Generator, Prompt Generator. Separation improves quality — diagnosis ≠ implementation
- **Proposer analysis protocol:** Mandatory steps before proposing: (1) use brainstorming skill, (2) inventory existing skills, (3) analyze feedback history for similar DISCARDED proposals, (4) determine action type. Anti-patterns enforced: no narrow single-case fixes, no overlapping capabilities with existing skills, must explain how proposal differs from past failures
- **Progressive context fallback (`_mutate_with_fallback`):** Three truncation levels when proposer hits context limits: Level 0 (60K head + 60K tail, full history), Level 1 (20K+10K, 20 feedback lines, max 3 failures), Level 2 (5K+2K, 5 feedback lines, max 2 failures). Single-failure fallback: if all levels fail with multiple failures, retry with shortest failure trace at max truncation
- **Agent trace summarization:** On failure, traces truncated to `head_chars + tail_chars` with `[... N chars truncated ...]` marker (default 60K+60K). Keeps context manageable for proposer without losing critical information
- **Parent selection strategies:** Three strategies for which frontier member to mutate from: `best` (greedy — always highest score), `random` (uniform), `round_robin` (cycle through ranked frontier). Selection strategy affects diversity of evolution
- **Category-aware round-robin sampling:** Failures not sampled randomly. Round-robin with per-category offsets ensures every failure category gets covered across iterations. State checkpointed for exact resume
- **Content-addressed run caching:** Cache key = `hash(behavior-affecting files) + hash(question)`. Behavior-affecting files = skills + prompt; metadata excluded. Automatic invalidation when skill instructions change (not metadata)
- **Checkpoint/resume mechanism:** Full loop state (iteration number, category offsets, per-category sampling positions) checkpointed to JSON. Enables exact resume after crash or restart
- **Feedback Descent algorithm (standalone, from arxiv.org/abs/2511.07919):** Alternative to population-based evolution. Pairwise comparison: current-best vs. candidate, feedback history **resets on improvement** (unlike main loop where it accumulates). Uses textual rationale instead of scalar rewards. Fewer iterations, converges faster for refinement

**What to adopt:**
- Propose/edit duality (create vs refine existing skill)
- Feedback history as accumulated context
- Markdown-based skill format (already in our system!)
- Frontier selection (keep top-N skill variants by quality score)
- **Proposer/Generator split** — separate LLM calls for diagnosis vs. implementation
- **Proposer guardrails** — mandatory protocol to avoid redundant/narrow skills
- **Progressive context fallback** — graceful degradation when hitting LLM context limits
- **Trace summarization** — head+tail truncation for feeding execution traces to proposer
- **Content-addressed caching** — avoid redundant LLM evaluations when skill hasn't changed
- **Checkpoint/resume** — make evolution Celery task idempotent and crash-resilient
- **Category-aware sampling** — cycle through workflow categories rather than always picking most frequent
- **Feedback Descent** — use for rapid single-skill refinement (pairwise comparison, fewer iterations)

### ROMA (Recursive Open Meta-Agent)
**Core idea:** Recursive task decomposition tree. Complex tasks → Planner → subtasks → recursion. Five modules: Atomizer, Planner, Executor, Aggregator, Verifier.

**Architecture:**
```
            [Parent Node]
           ↙      ↓      ↘
      [Node A] → [Node B] → [Node C]     ← horizontal context sharing
         ↓                                 ← recursive decomposition
    [Sub A.1] [Sub A.2]
```

**Key patterns:**
- **Three-directional context flow:** Top-down (prompt+context), bottom-up (results), left-to-right (sibling deps)
- **Atomizer routing:** Decides if task is atomic (execute) or needs decomposition (plan)
- **Verifier quality gate:** Inspects aggregated output against original goal, rejects if quality check fails
- **Typed SubTask:** `{goal, task_type, dependencies}`
- **No persistent learning:** Runtime-only — no cross-session skill evolution

**What to adopt:**
- Verifier pattern for skill quality gating
- Three-directional context flow for canvas nodes
- Atomizer concept for routing between skill execution vs. decomposition
- Typed subtask structure for canvas nodes

### Voyager (Skill Library Pioneer)
**Key patterns:**
- **Code-as-skill:** Each skill = executable function
- **Vector DB retrieval:** Skills stored with description embeddings; top-5 retrieved by semantic similarity to current task
- **Three feedback types:** Execution errors + environment state + LLM peer review
- **Automatic curriculum:** Progressively harder tasks based on current capabilities
- **Self-verification:** Separate LLM call verifies task completion before adding skill to library

**What to adopt:**
- Embedding-based skill retrieval (we already do this for workflow matching!)
- Self-verification before skill promotion
- Progressive curriculum (auto-suggest next skill to learn)

### ADAS / Meta Agent Search (ICLR 2025)
**Key pattern:** Meta-agent programs new agents in code, tests them, adds successful ones to archive, references archive for future iterations. Turing-complete search space (code representation).

**What to adopt:** Archive of discovered agents/skills as searchable reference for meta-agent

### AFLOW (ICLR 2025 Oral)
**Key pattern:** Workflows as graphs of LLM-invoking nodes. Operators = reusable node combinations (Ensemble, Review & Revise). Monte Carlo Tree Search for workflow optimization.

**What to adopt:** Operator abstraction — reusable graph patterns that become skills

### SAGE (Amazon, 2025)
**Key pattern:** RL with dual reward: outcome completion + skill quality/reusability. Skills from earlier tasks accumulate in library for later tasks.

**What to adopt:** Dual reward signal — task success AND skill reusability

### HERAKLES (2025)
**Key pattern:** Hierarchical skill compilation — once a multi-step trajectory is mastered, compile it into a single callable skill. Growing hierarchy of increasingly abstract skills.

**What to adopt:** Workflow → compiled skill promotion (exactly what our canvas-to-skill pipeline should do)

---

## 2. Current Onyx Architecture (What We're Building On)

### Workflow Canvas (Neo4j + React Flow)
```
Workflow → Execution → Step
                         ↑
                    Annotation (feedback)
```

- **Post-turn sync (TO BE REMOVED):** Currently every agent turn → Celery task → LLM summarize → Neo4j write. This produces messy per-turn nodes that don't match the clean flow we want. Will be replaced by post-conversation Judge that produces the canonical flow.
- **Embedding-based matching:** New task names matched to existing Workflows (>0.8 similarity)
- **Canvas builder:** Merges similar nodes within workflow (>0.85), creates cross-workflow edges (>0.9)
- **Frontend:** React Flow with Dagre layout, custom WorkflowNode/WorkflowEdge components

### Skill System
- **Format:** `.md` files with YAML frontmatter OR database `Skill` records
- **Runtime:** Agent calls `use_skill(slug)` → gets full instructions injected
- **CRUD:** Full API at `/admin/skill` and `/skill`
- **Gating:** `requires_tools`, `modes`, `enabled` flags

### Gap Analysis (What's Missing)
| Capability | Status |
|---|---|
| Post-conversation flow synthesis | **NOT BUILT** (per-turn sync produces raw nodes, not clean flows) |
| Conversation outcome judgment | **NOT BUILT** (no success/failure signal for chat sessions) |
| Conversation close detection | **NOT BUILT** (only goal status for inbox; no general idle/turn-based detection) |
| Flow = Skill equivalence | **NOT BUILT** (canvas flows and skills are disconnected concepts) |
| Skill creation from workflow patterns | **NOT BUILT** |
| Skill discovery from conversations | **NOT BUILT** (only manual `use_skill`) |
| Skill feedback/evolution | **NOT BUILT** (Annotation exists but doesn't feed back) |
| Skill-to-skill composition | **NOT BUILT** (flat, one skill at a time) |
| Skill versioning | **NOT BUILT** |
| Skill quality scoring | **NOT BUILT** |

---

## 3. Proposed Architecture

### 3.1 Skill Lifecycle

**Key principle: Flow = Skill.** The flow displayed on the canvas and the skill the agent executes are the same thing. A flow is the visual representation; a skill is the executable representation. They share the same steps.

```
[Agent Conversations (all session types: inbox, chat, etc.)]
        ↓
[Conversation Close Detection] ←── NEW: turns ≥ 4 AND idle ≥ 15 min, OR goal completed/cancelled
        ↓
[LLM Judge] ←── NEW: single LLM call that does THREE things:
  │               1. Synthesizes clean flow from raw conversation (replaces per-turn sync)
  │               2. Evaluates quality (success/partial/failure/abandoned)
  │               3. Produces pattern_summary for cross-conversation matching
  ↓
[Neo4j Write] ←── Write clean flow as Workflow → Execution → Steps
  │                + quality + pattern_summary on Execution node
  ↓
[Match Check] ←── Does this flow match an existing Workflow? (embedding similarity on pattern_summary)
  │                Yes → increment execution count on existing Workflow
  │                No  → new Workflow node created
  ↓
[Proposer Check] ←── Should we create/evolve a skill? (simple conditional, no LLM)
  │                   Workflow has ≥ N executions + no derived skill → Proposer (create)
  │                   Workflow has derived skill + quality is failure/partial → Proposer (edit)
  │                   Otherwise → done, stop here
  ↓
[Skill Proposer] ←── ALL diagnosis intelligence (LLM call)
  │                   Sees: flow steps, execution traces, feedback history, existing skills
  │                   Decides: create vs edit, which skill, what it should do
  ↓
[Skill Generator] ←── Implements what proposer described (LLM call)
  │                    Output = skill instructions that mirror the flow steps
  ↓
[Auto-Promote to Skill Registry] ←── No human gate; goes live immediately
        ↓
[Skill Registry] ←── already built (DB + file system)
  │                   + DERIVED_FROM edge linking Skill → Workflow in Neo4j
  ↓
[Human Correction] ←── OPTIONAL: edit flow on canvas = edit skill (same thing)
        ↓
[Skill Execution] ←── already built (use_skill tool)
        ↓
(loop back — next conversation gets judged, matched, and may trigger evolution)
```

**No per-turn sync.** Nothing is written to Neo4j during the conversation. The Judge produces the canonical flow after the conversation closes. This eliminates the messy raw-turn nodes and ensures the canvas always shows clean, meaningful flows.

**Event-driven, not periodic.** The entire pipeline (Judge → Match → Proposer → Generator) runs as a single Celery task chain triggered by conversation close. No separate collector or periodic polling.

### 3.2 Data Model Extensions

#### Skill Version (new Neo4j node)
```python
class SkillVersionNode:
    skill_id: str           # Links to PostgreSQL Skill.id
    version: int            # Monotonic version counter
    instructions_hash: str  # Content hash of instructions
    quality_score: float    # Aggregated from feedback (0.0 - 1.0)
    execution_count: int    # How many times this version was used
    success_rate: float     # % of executions rated positively
    created_at: datetime
    source_workflow_id: str # Which workflow pattern spawned this version
```

#### Skill Composition Edge (new Neo4j relationship)
```
(:Skill)-[:COMPOSES {order: int, context_mapping: dict}]->(:Skill)
```
Enables skill-to-skill connections (flow-to-flow).

#### Skill-Workflow Link (new Neo4j relationship)
```
(:Skill)-[:DERIVED_FROM]->(:Workflow)
(:Skill)-[:USED_IN]->(:Execution)
```

### 3.3 Post-Conversation Pipeline (Judge → Match → Proposer → Generator)

The entire pipeline runs as a **single Celery task chain** triggered by conversation close. No periodic polling, no separate collector — everything is event-driven.

#### Step 1: Conversation Close Detection

A Celery periodic task (every 5 minutes) finds conversations that are "done":

```sql
SELECT sessions WHERE
  (goal_status IN ('completed', 'cancelled'))              -- inbox with goal (instant)
  OR (turn_count >= 4 AND last_message_at < now() - 15min) -- all session types (idle)
  AND NOT already_processed                                 -- skip if already in pipeline
```

| Condition | Applies to | Rationale |
|---|---|---|
| `goal_status` changed | Inbox with goals only | Strongest signal — user explicitly marked done |
| `turn_count >= 4` | All session types | At least 2 user + 2 agent messages — enough substance |
| Idle ≥ 15 minutes | All session types | User probably moved on, not just thinking |
| `NOT already_processed` | All | Don't re-process |

Each qualifying conversation triggers the pipeline below as a Celery task chain.

#### Step 2: LLM Judge

A single LLM call that reads the full conversation transcript + goal (if any) and produces **both** the clean flow and the quality assessment. This **replaces per-turn sync** — nothing is written to Neo4j during the conversation.

```python
class FlowStep(BaseModel):
    name: str                  # e.g. "Query user data"
    description: str           # e.g. "Search DB by name/email, return matching records"

class ConversationJudgment(BaseModel):
    # --- Clean flow (replaces per-turn sync) ---
    flow: list[FlowStep]       # The canonical steps the agent followed
    pattern_summary: str        # e.g. "multi-step data export with validation"
                                # Used for embedding + cross-conversation matching

    # --- Quality assessment ---
    quality: Literal["success", "partial", "failure", "abandoned"]
    failure_steps: list[str]    # e.g. ["step 3: used wrong table schema"] (only if quality != success)
    root_cause: str | None      # e.g. "agent lacks knowledge of DB schema" (only if quality != success)
    confidence: float           # 0.0 - 1.0
```

Key: `quality` and `flow` are **independent axes**. A successful conversation still produces a flow that may become a skill. A failed conversation still produces a flow that shows what went wrong.

#### Step 3: Neo4j Write + Workflow Matching

Write the clean flow to Neo4j, then check if it matches an existing Workflow:

1. Embed the `pattern_summary`
2. Compare against existing Workflow embeddings (similarity threshold, e.g. >0.8)
3. **Match found** → link this Execution to the existing Workflow, increment execution count
4. **No match** → create new Workflow node with this as its first Execution

```
(:Workflow {pattern_summary, embedding, execution_count})
    -[:HAS_EXECUTION]->
        (:Execution {quality, confidence, root_cause, conversation_id})
            -[:HAS_STEP {order}]->
                (:Step {name, description})
```

#### Step 4: Proposer Check (simple conditional — no LLM)

Decide whether to run the Proposer. Three cases:

| Condition | Action |
|---|---|
| Workflow has ≥ N executions (default 3) + no `DERIVED_FROM` Skill | → Proposer with `action: "create"` |
| Workflow has a derived Skill + this execution's quality is `failure` or `partial` | → Proposer with `action: "edit"` |
| Otherwise | → **Stop here.** Pipeline done. |

Most conversations will stop at this step. The Proposer only fires when there's a real signal.

#### Step 5: Skill Proposer (diagnosis — LLM call)

All intelligence lives here. The Proposer receives:
- The flow steps from the Judge
- Sample execution traces from the matched Workflow (summarized with head+tail truncation)
- Feedback history (accumulated log of past proposals + outcomes)
- Existing skills inventory

**Mandatory protocol** (from EvoSkill):
1. Inventory existing skills — check for overlap
2. Check feedback history for similar DISCARDED proposals
3. Determine create vs. edit

**Anti-pattern guardrails:**
- Reject if proposed skill overlaps existing skill capabilities (propose edit instead)
- Reject narrow single-case fixes (must generalize across executions)
- Must reference `related_iterations` if similar proposals were previously discarded

**Output:**
```python
class ProposerOutput(BaseModel):
    action: Literal["create", "edit"]
    target_skill: str | None        # which skill to edit (if action="edit")
    proposed_skill: str             # description of what to build/change
    justification: str              # why, with references to specific execution traces
    related_iterations: list[str]   # past proposals referenced
```

**Progressive context fallback** (if proposer fails due to context limit / timeout):
- Level 0: Full traces (60K head + 60K tail), full feedback history
- Level 1: Moderate truncation (20K+10K), 20 feedback lines, max 3 executions
- Level 2: Aggressive truncation (5K+2K), 5 feedback lines, max 2 executions
- Single-execution fallback: retry with shortest trace at max truncation

#### Step 6: Skill Generator (implementation — LLM call)

Receives the Proposer's output + the flow steps. Produces the actual skill content.

The generated skill **mirrors the flow steps** — same structure, same order. The flow is the visual representation; the skill is the executable representation.

**Output:**
```python
class GeneratorOutput(BaseModel):
    slug: str
    name: str
    description: str
    instructions: str              # full .md content — skill body
```

#### Step 7: Auto-Promote

- Skill created in PostgreSQL as `enabled=True` with `quality_score=0.0`
- `DERIVED_FROM` edge created in Neo4j linking Skill → Workflow
- Skill goes live immediately — no human review gate
- Humans can correct via canvas UI or API (editing the flow = editing the skill)
- Version history tracks all changes for rollback
- Feedback history updated with proposal outcome

### 3.5 Skill Discovery from Conversations

**Two-layer approach:**

**Layer 1 — Reactive (at agent runtime):**
- When agent receives a message, embed it
- Compare against skill description embeddings (already have embedding infrastructure)
- If similarity > 0.7, suggest skill to agent via system prompt injection
- Agent still decides whether to call `use_skill`

**Layer 2 — Post-conversation matching (built into pipeline):**
- The Judge's `pattern_summary` is embedded and matched against existing Workflows (Step 3 of pipeline)
- If matched Workflow has a derived Skill, the Skill is already available for future conversations
- Next time a user starts a similar conversation, Layer 1 picks up the Skill reactively

### 3.6 Feedback Mechanisms

#### Per-Box Feedback (node-level)
- User clicks a Step node on canvas → rates it (👍/👎) + optional comment
- Stored as `AnnotationNode` on the Step
- Aggregated into skill quality score for the canonical_action

#### Edge-Based Feedback
- User clicks an edge on canvas → rates the transition
- "This step shouldn't follow that step" or "These steps should be combined"
- Stored as `AnnotationNode` on the Edge
- Feeds into skill structure evolution (reorder/merge/split steps)

#### New Node Feedback
- User drags a new node onto canvas → "This step is missing"
- Creates a proposal to add a step to the skill
- LLM integrates the new step into the skill instructions

#### Skill-to-Skill Feedback (Flow-to-Flow)
- User connects two workflow patterns on canvas
- Creates `COMPOSES` edge between the two derived skills
- LLM generates a "meta-skill" that orchestrates the two

### 3.7 Skill Evolution Loop

Two complementary evolution strategies, inspired by EvoSkill:

#### Strategy A — Population-Based Evolution (for skills with many executions)

For skills with a rich execution history. Maintains a frontier of top-N skill versions and evolves by mutation + selection.

```python
class SkillEvolver:
    def evolve(self, skill_id: str):
        # 1. Gather feedback
        annotations = neo4j.get_annotations_for_skill(skill_id)
        recent_executions = neo4j.get_recent_executions(skill_id, limit=10)
        failures = [e for e in recent_executions if e.success == False]

        # 2. Decide action
        if len(failures) / len(recent_executions) > 0.3:
            action = "edit"  # Too many failures, needs improvement
        elif has_new_composition_feedback(skill_id):
            action = "compose"  # User wants to chain skills
        else:
            return  # Skill is performing well

        # 3. Select parent version from frontier
        parent = select_from_frontier(
            skill_id,
            strategy="round_robin"  # or "best", "random"
        )

        # 4. Propose changes (Skill Proposer — diagnosis LLM call)
        #    With progressive context fallback on failure
        proposal = skill_proposer.propose(
            current_instructions=parent.instructions,
            failures=summarize_traces(failures),  # head+tail truncation
            feedback=annotations,
            feedback_history=get_feedback_history(skill_id),
            existing_skills=get_all_skills(),  # for overlap check
            action=action
        )
        # Proposer guardrails: reject if overlaps existing skill,
        # reject narrow single-case fixes, must reference related_iterations

        # 5. Implement changes (Skill Generator — separate LLM call)
        new_instructions = skill_generator.generate(
            proposal=proposal,
            current_instructions=parent.instructions
        )

        # 6. Create new version (don't overwrite)
        new_version = SkillVersionNode(
            skill_id=skill_id,
            version=current_version + 1,
            instructions_hash=content_hash(new_instructions),
            quality_score=0.0,  # Will be populated by usage
            source="evolution"
        )

        # 7. Record feedback history
        append_feedback_history(skill_id, {
            "iteration": new_version.version,
            "proposal": proposal.justification,
            "outcome": "PENDING",  # updated after executions
            "active_skills": get_active_skill_slugs()
        })

        # 8. Update frontier (keep top-N by quality_score)
        update_frontier(skill_id, new_version, max_size=3)

        # 9. A/B test or promote
        # Option A: Auto-promote (for high-confidence edits)
        # Option B: Queue for human review
        # Option C: A/B test (50% of executions use new version)
```

#### Strategy B — Feedback Descent (for rapid single-skill refinement)

For skills that need quick targeted improvement (e.g., user explicitly reported a problem). Uses pairwise comparison instead of population-based evolution. Based on arxiv.org/abs/2511.07919.

```python
class FeedbackDescentRefiner:
    """Faster convergence for single-skill refinement.
    Key difference from population evolution: feedback history
    RESETS on improvement (not accumulated)."""

    def refine(self, skill_id: str, max_iterations: int = 10):
        current_best = get_skill_instructions(skill_id)
        feedback_history = []

        for i in range(max_iterations):
            # 1. Propose candidate (Skill Proposer)
            candidate = skill_proposer.propose_refinement(
                current_best=current_best,
                feedback_history=feedback_history
            )

            # 2. Pairwise comparison (Evaluator LLM call)
            #    Compare current_best vs candidate on recent execution traces
            result = evaluator.compare(
                current_best=current_best,
                candidate=candidate,
                test_traces=get_recent_traces(skill_id)
            )

            # 3. Update
            if result.preference == "candidate":
                current_best = candidate
                feedback_history = []  # RESET on improvement
                create_new_version(skill_id, candidate)
            else:
                feedback_history.append(result.rationale)

            # 4. Early stop if no improvement for k iterations
            if len(feedback_history) >= 3:
                break

        return current_best
```

**When to use which strategy:**
| Scenario | Strategy |
|---|---|
| Periodic background evolution (Celery task) | Population-based (Strategy A) |
| User reports skill problem via canvas feedback | Feedback Descent (Strategy B) |
| Newly auto-created skill needs polish | Feedback Descent (Strategy B) |
| Skill with many versions, need diversity | Population-based (Strategy A) |

### 3.8 Frontend Canvas Extensions

#### New Node Types
```typescript
type CanvasNodeType =
  | "input"      // existing
  | "compute"    // existing
  | "output"     // existing
  | "skill"      // NEW: represents a skill invocation (auto-created, editable)
  | "feedback"   // NEW: feedback collection point
```

#### New Edge Types
```typescript
type CanvasEdgeType =
  | "sequential"     // existing (NEXT)
  | "cross_workflow"  // existing
  | "skill_compose"   // NEW: skill-to-skill composition
  | "derived_from"    // NEW: skill derived from workflow pattern
  | "feedback"        // NEW: feedback annotation edge
```

#### New Canvas Interactions
- **Right-click workflow → "Create Skill"** — manually trigger skill creation from pattern
- **Drag between workflows → "Connect Flows"** — create skill composition
- **Click node → feedback drawer** — rate, comment, suggest changes
- **"Skill Evolution" panel** — shows version history, quality scores, A/B test results

---

## 4. Implementation Priority

### Phase 1: Post-Conversation Pipeline (Foundation)
- Remove per-turn sync (workflow summarizer, per-turn Celery task, per-turn embedding matcher)
- Conversation close detection Celery task (turns ≥ 4 + idle ≥ 15min, or goal completed/cancelled)
- LLM Judge: synthesize clean flow + evaluate quality + produce pattern_summary
- Neo4j write: Workflow → Execution → Steps (clean flow from Judge)
- Workflow matching: embed pattern_summary, match to existing Workflows
- Add `DERIVED_FROM` Neo4j relationship for skills
- Add `SkillVersionNode` to Neo4j models

### Phase 2: Proposer → Generator (Automated Skill Creation)
- Proposer check: simple conditional after workflow matching (≥N executions + no skill → create; failing skill → edit)
- Skill Proposer (LLM call): all diagnosis intelligence — create vs. edit, guardrails, feedback history
- Skill Generator (LLM call): implements proposer's description, mirrors flow steps
- Progressive context fallback (3 truncation levels)
- Auto-promote: skill goes live immediately, humans correct after
- Flow = Skill: editing flow on canvas = editing skill (same structure)

### Phase 3: Feedback Collection
- Per-box annotation UI (already partially exists)
- Edge annotation UI
- New node suggestion UI
- Connect annotations to skill quality scores
- Annotations feed back into Collector → Proposer pipeline as evolution candidates

### Phase 4: Skill Evolution
- Population-based evolution (background Celery — frontier of top-N versions)
- Feedback Descent (on-demand — rapid pairwise refinement)
- Version management (create new version, not overwrite)
- A/B testing framework for skill versions
- Skill composition (flow-to-flow)

### Phase 5: Proactive Discovery
- Embedding-based skill suggestion at agent runtime
- Post-conversation skill matching
- Skill recommendation engine

---

## 5. Key Design Decisions

| Decision | Recommendation | Rationale |
|---|---|---|
| Skill format | Keep `.md` with YAML frontmatter | Already built, matches EvoSkill pattern, human-readable |
| Skill storage | PostgreSQL (source of truth) + Neo4j (graph relationships) | Relational for CRUD, graph for composition/lineage |
| Skill versioning | Immutable versions in Neo4j, latest in PostgreSQL | Never overwrite — create new version, track lineage |
| Feedback aggregation | Weighted moving average of annotations | Recent feedback weighted more than old |
| Per-turn sync | **Remove** — replace with post-conversation Judge | Per-turn produces messy raw nodes; Judge produces clean flow that matches skill structure |
| Flow = Skill | Same structure, same steps | Canvas shows the flow, agent executes the skill — editing one edits the other |
| Conversation close signal | turns ≥ 4 AND idle ≥ 15min, OR goal completed/cancelled | Works for all session types (inbox, chat); turn threshold avoids judging trivial conversations; idle timeout avoids judging mid-conversation |
| Quality signal source | LLM-as-judge on completed conversations (not benchmark ground truth) | No ground truth in chat — LLM judge synthesizes clean flow + classifies quality + extracts failure steps |
| Skill creation trigger | ≥N workflow executions (default 3) + no existing derived skill | Balance automation vs. noise; matching based on embedded pattern_summary |
| Pipeline trigger | Event-driven off conversation close (not periodic) | Single Celery task chain: Judge → Match → Proposer → Generator. Faster feedback loop, one less periodic task |
| Human review gate | **None** — auto-create, humans correct after | Reduces friction; versioning makes correction safe |
| Skill evolution trigger | >30% failure rate OR explicit user feedback | Don't fix what isn't broken |
| Composition model | Neo4j COMPOSES edges + meta-skill generation | Graph-native, LLM generates orchestration instructions |
| Discovery mechanism | Embedding similarity (>0.7) at agent runtime | Lightweight, non-blocking, agent still decides |
| Proposer/Generator split | Separate LLM calls for diagnosis vs. implementation | EvoSkill pattern — diagnosis quality improves when not also generating code |
| Proposer guardrails | Mandatory protocol: inventory skills, check history, reject overlaps | Prevents redundant/narrow skills; learned from EvoSkill anti-patterns |
| Context fallback | 3 truncation levels (60K→20K→5K) with single-failure fallback | Graceful degradation when hitting LLM context limits |
| Trace summarization | Head+tail truncation with `[... N chars truncated ...]` marker | Keeps critical info from both start and end of execution |
| Evolution caching | Content-addressed: `hash(skill instructions) + hash(workflow)` | Skip re-analysis when skill content hasn't changed |
| Evolution checkpoint | Persist iteration + category offsets to Redis/PostgreSQL | Celery task idempotent and crash-resilient |
| Category sampling | Round-robin with per-category offsets | Avoids bias toward most-frequent workflow categories |
| Evolution strategy | Population-based (background) + Feedback Descent (on-demand) | Population for diversity, Feedback Descent for rapid targeted refinement |
| Parent selection | Round-robin across frontier versions | Balances exploitation (best) with exploration (diversity) |
| Feedback history reset | Accumulate in population mode; reset on improvement in Feedback Descent | EvoSkill pattern — prevents proposer from repeating discarded ideas |

---

## 6. References

- **EvoSkill** — github.com/sentient-agi/EvoSkill (evolutionary skill improvement)
- **ROMA** — sentient.xyz/blog/recursive-open-meta-agent (recursive task decomposition)
- **Voyager** — voyager.minedojo.org (skill library + vector retrieval pioneer)
- **ADAS** — arxiv.org/abs/2408.08435 (meta-agent search, ICLR 2025)
- **AFLOW** — arxiv.org/abs/2410.10762 (graph workflow optimization, ICLR 2025 Oral)
- **SAGE** — arxiv.org/abs/2512.17102 (RL + skill quality reward)
- **HERAKLES** — arxiv.org/abs/2508.14751 (hierarchical skill compilation)
- **CycleQD** — arxiv.org/abs/2410.14735 (quality-diversity skill variants)
- **EXIF** — arxiv.org/abs/2506.04287 (exploration-based skill discovery)
- **Godel Agent** — arxiv.org/abs/2410.04444 (self-referential agent, ACL 2025)
- **Darwin Godel Machine** — sakana.ai/dgm (self-evolving agent code)
- **Agent Skills Survey** — arxiv.org/html/2602.12430v3 (comprehensive taxonomy)
- **GoalAct** — arxiv.org/abs/2504.16563 (hierarchical execution)
- **Feedback Descent** — arxiv.org/abs/2511.07919 (pairwise text optimization via comparison)
