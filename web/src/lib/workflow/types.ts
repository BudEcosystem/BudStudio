// Node types matching backend Neo4j schema

export type ExecutionStatus = "running" | "completed" | "failed";
export type ExecutionMode = "interactive" | "cron" | "inbox";
export type StepStatus = "completed" | "failed" | "skipped";
export type ToolSource = "local" | "remote" | "mcp" | "connector";
export type ArtifactType = "email" | "table" | "chart" | "code" | "report";
export type AnnotatorKind = "HUMAN" | "LLM" | "CODE";
export type AnnotationTargetType = "step" | "execution";

export interface Workflow {
  id: string;
  name: string;
  description: string;
  execution_count: number;
  last_run_at: string | null;
  avg_duration_ms: number;
  success_rate: number;
  tags: string[];
  created_at: string;
}

export interface Execution {
  id: string;
  agent_session_id: string;
  turn_numbers: number[];
  status: ExecutionStatus;
  mode: ExecutionMode;
  input_summary: string;
  output_summary: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number;
  step_count: number;
  raw_step_count: number;
  created_at: string;
}

export interface WorkflowStep {
  id: string;
  position: number;
  name: string;
  description: string;
  status: StepStatus;
  duration_ms: number;
  canonical_action: string;
  created_at: string;
}

export interface RawStep {
  id: string;
  step_index: number;
  tool_name: string;
  tool_source: ToolSource;
  mcp_server: string | null;
  inputs: string;
  outputs: string;
  error: string | null;
  status: string;
  duration_ms: number;
  agent_message_id: string | null;
  created_at: string;
}

export interface WorkflowArtifact {
  id: string;
  artifact_type: ArtifactType;
  title: string;
  data: string;
  created_at: string;
}

export interface Annotation {
  id: string;
  name: string;
  score: number | null;
  label: string | null;
  comment: string | null;
  annotator_kind: AnnotatorKind;
  user_id: string;
  created_at: string;
}

export interface AnnotationInput {
  name: string;
  score?: number;
  label?: string;
  comment?: string;
}

// React Flow compatible types
export interface WorkflowNodeData extends Record<string, unknown> {
  step: WorkflowStep;
  executionCount: number; // how many executions hit this step
  totalExecutions: number; // total executions of this workflow
  isGoldenPath: boolean;
  // Multi-workflow fields (set in unified canvas mode)
  workflowId?: string;
  workflowName?: string;
  workflowColor?: string;
  isSharedAction?: boolean;
  // Node type classification
  nodeType?: "input" | "compute" | "output";
  inputSource?: "human" | "agent" | null;
  // Derived skill info (if this workflow has an auto-created skill)
  derivedSkillSlug?: string;
  derivedSkillName?: string;
}

export interface WorkflowCanvasNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowCanvasEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  data?: { frequency?: number; workflowId?: string; workflowColor?: string; label?: string; goal?: string };
}

export interface WorkflowCanvasData {
  workflow: Workflow;
  executions: Execution[];
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
}

export interface UnifiedCanvasData {
  workflows: Workflow[];
  nodes: WorkflowCanvasNode[];
  edges: WorkflowCanvasEdge[];
  sharedActions: string[];
}

export interface AlternativeApproach {
  execution_id: string;
  input_summary: string;
  tools_used: string[];
  duration_ms: number;
}

export interface GoldenPath {
  path: string[]; // canonical_action sequence
  frequency: number;
}

export interface ExecutionDetail {
  execution: Execution;
  steps: WorkflowStep[];
  raw_steps: RawStep[];
  artifacts: WorkflowArtifact[];
}
