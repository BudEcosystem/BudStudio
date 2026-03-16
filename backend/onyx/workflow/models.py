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
