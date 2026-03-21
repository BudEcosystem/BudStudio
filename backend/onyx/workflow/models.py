from datetime import datetime
from uuid import uuid4

from pydantic import BaseModel
from pydantic import Field


class WorkflowNode(BaseModel):
    """Represents a reusable workflow (e.g. 'Draft MOM Email')."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    tenant_id: str
    user_id: str
    name: str  # "Draft MOM Email"
    description: str
    name_embedding: list[float] = []
    pattern_summary: str | None = None  # canonical pattern description for matching
    pattern_embedding: list[float] | None = None  # embedding of pattern_summary
    execution_count: int = 0
    last_run_at: datetime | None = None
    avg_duration_ms: float = 0
    success_rate: float = 1.0
    tags: list[str] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class ExecutionNode(BaseModel):
    """A single run of a workflow, tied to an agent session."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    agent_session_id: str
    turn_numbers: list[int] = []
    status: str = "running"  # running|completed|failed
    mode: str = "interactive"  # interactive|cron|inbox
    input_summary: str = ""
    output_summary: str = ""
    started_at: datetime = Field(default_factory=datetime.utcnow)
    completed_at: datetime | None = None
    duration_ms: int = 0
    step_count: int = 0
    raw_step_count: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

    # Judgment (populated by LLM Judge after conversation close)
    quality: str | None = None  # "success" | "partial" | "failure" | "abandoned"
    pattern_summary: str | None = None  # for cross-conversation matching
    root_cause: str | None = None  # only if quality != "success"
    confidence: float | None = None
    judged_at: str | None = None  # ISO timestamp


class StepNode(BaseModel):
    """A human-readable logical step within an execution."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    position: int  # order within execution
    name: str  # "Find meeting notes" (human-readable)
    description: str = ""
    status: str = "completed"  # completed|failed|skipped
    duration_ms: int = 0
    canonical_action: str  # "find_meeting" (for cross-execution matching)
    node_type: str = "compute"  # input | compute | output
    input_source: str | None = None  # human | agent (only for input nodes)
    transition_goal: str = ""  # goal of edge to next node
    edge_type: str = "NEXT"  # Neo4j relationship type (e.g. PREPARE_DATA)
    embedding: list[float] = Field(default_factory=list)  # semantic embedding
    created_at: datetime = Field(default_factory=datetime.utcnow)


class RawStepNode(BaseModel):
    """A raw tool invocation within an execution (maps to a packet)."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    step_index: int  # order within execution (maps to packet ind)
    tool_name: str
    tool_source: str = "remote"  # local|remote|mcp|connector
    mcp_server: str | None = None
    inputs: str = "{}"  # JSON string
    outputs: str = "{}"  # JSON string
    error: str | None = None
    status: str = "completed"
    approval_status: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int = 0
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    agent_message_id: str | None = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ArtifactNode(BaseModel):
    """An artifact produced by a step (email, table, chart, etc.)."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    artifact_type: str  # email|table|chart|code|report
    title: str
    data: str = "{}"  # JSON string
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnnotationNode(BaseModel):
    """An evaluation annotation on a step or execution."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str  # evaluation dimension (e.g., "correctness")
    score: float | None = None
    label: str | None = None
    comment: str | None = None
    annotator_kind: str = "HUMAN"  # HUMAN|LLM|CODE
    user_id: str = ""
    created_at: datetime = Field(default_factory=datetime.utcnow)


class AnnotationInput(BaseModel):
    """Input model for creating annotations on steps or executions."""

    name: str
    score: float | None = None
    label: str | None = None
    comment: str | None = None


# Summary models (used by the summarizer, not stored in Neo4j directly)


class StepSummary(BaseModel):
    """Summary of a single step, used during workflow extraction."""

    name: str
    description: str
    canonical_action: str
    node_type: str = "compute"  # input | compute | output
    input_source: str | None = None  # human | agent (only for input nodes)
    transition_goal: str = ""  # goal/purpose of the edge to the next node
    edge_type: str = "NEXT"  # Neo4j relationship type (e.g. PREPARE_DATA)


class TurnSummary(BaseModel):
    """Summary of a conversation turn, used during workflow extraction."""

    task_name: str
    steps: list[StepSummary]


# Skill evolution pipeline models


class FlowStep(BaseModel):
    """A clean, human-readable step synthesized by the Judge from a conversation."""

    name: str  # e.g. "Query user data"
    description: str  # e.g. "Search DB by name/email, return matching records"


class ConversationJudgment(BaseModel):
    """Output of the LLM Judge — clean flow + quality assessment."""

    # Clean flow (replaces per-turn sync)
    flow: list[FlowStep]
    pattern_summary: str  # e.g. "multi-step data export with validation"

    # Quality assessment
    quality: str  # "success" | "partial" | "failure" | "abandoned"
    failure_steps: list[str] = []  # e.g. ["step 3: used wrong table schema"]
    root_cause: str | None = None
    confidence: float = 0.0


class ProposerOutput(BaseModel):
    """Output of the Skill Proposer — diagnosis of what skill to create/edit."""

    action: str  # "create" | "edit"
    target_skill: str | None = None  # slug of skill to edit (if action="edit")
    proposed_skill: str  # description of what to build/change
    justification: str  # why, with references to traces
    related_iterations: list[str] = []


class GeneratorOutput(BaseModel):
    """Output of the Skill Generator — actual skill content."""

    slug: str
    name: str
    description: str
    instructions: str  # full .md content — skill body


class SkillVersionNode(BaseModel):
    """Tracks versions of a skill in Neo4j for evolution tracking."""

    id: str = ""
    skill_id: str = ""  # Links to PostgreSQL Skill.id
    version: int = 1
    instructions_hash: str = ""  # Content hash of instructions
    quality_score: float = 0.0
    execution_count: int = 0
    success_rate: float = 0.0
    created_at: str = ""
    source: str = ""  # "auto_created" | "evolution" | "human"
    source_workflow_id: str = ""  # Which Workflow pattern spawned this version
