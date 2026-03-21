import {
  Workflow,
  Execution,
  WorkflowCanvasData,
  WorkflowCanvasEdge,
  WorkflowCanvasNode,
  WorkflowNodeData,
  UnifiedCanvasData,
  ExecutionDetail,
  RawStep,
  AlternativeApproach,
  GoldenPath,
  Annotation,
  AnnotationInput,
  AnnotationTargetType,
} from "./types";

const WORKFLOW_API_BASE = "/api/workflow";

interface ApiResponse<T> {
  data: T | null;
  error: string | null;
}

async function handleJsonResponse<T>(
  response: Response,
  context: string
): Promise<ApiResponse<T>> {
  if (!response.ok) {
    let errorDetail: string;
    try {
      const errorJson = await response.json();
      errorDetail = errorJson.detail || errorJson.message || "Unknown error";
    } catch {
      errorDetail = await response.text();
    }
    return {
      data: null,
      error: `Failed to ${context}: ${errorDetail}`,
    };
  }

  const data: T = await response.json();
  return { data, error: null };
}

export async function fetchWorkflows(
  minExecutions: number = 2
): Promise<ApiResponse<Workflow[]>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}?min_executions=${encodeURIComponent(minExecutions)}`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return handleJsonResponse<Workflow[]>(response, "fetch workflows");
  } catch (error) {
    console.error("Error fetching workflows:", error);
    return { data: null, error: "Error fetching workflows" };
  }
}

/**
 * Transform raw backend node data into the shape expected by WorkflowCanvasNode.
 *
 * The backend returns flat fields (canonical_action, name, description, frequency,
 * total_executions, status, avg_duration_ms) while the frontend expects
 * { step: WorkflowStep, executionCount, totalExecutions, isGoldenPath }.
 */
/** Raw node shape from the backend (flat fields, not typed). */
interface RawCanvasNode {
  id: string;
  type?: string;
  position?: { x: number; y: number };
  data?: {
    position?: number;
    name?: string;
    canonical_action?: string;
    description?: string;
    status?: string;
    avg_duration_ms?: number;
    duration_ms?: number;
    created_at?: string;
    frequency?: number;
    executionCount?: number;
    total_executions?: number;
    totalExecutions?: number;
    isGoldenPath?: boolean;
    workflow_id?: string;
    workflow_name?: string;
    derived_skill_slug?: string;
    derived_skill_id?: number;
  };
}

function transformCanvasNodes(
  rawNodes: RawCanvasNode[]
): WorkflowCanvasNode[] {
  return rawNodes.map((n) => {
    const d = n.data ?? {};
    return {
      id: n.id,
      type: n.type ?? "workflowStep",
      position: n.position ?? { x: 0, y: 0 },
      data: {
        step: {
          id: n.id,
          position: d.position ?? 0,
          name: d.name ?? d.canonical_action ?? "Step",
          description: d.description ?? "",
          status: (d.status as "completed" | "failed" | "skipped") ?? "completed",
          duration_ms: d.avg_duration_ms ?? d.duration_ms ?? 0,
          canonical_action: d.canonical_action ?? "",
          created_at: d.created_at ?? "",
        },
        executionCount: d.frequency ?? d.executionCount ?? 0,
        totalExecutions: d.total_executions ?? d.totalExecutions ?? 0,
        isGoldenPath: d.isGoldenPath ?? false,
      },
    };
  });
}

// 10-color palette for multi-workflow canvas
const WORKFLOW_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
  "#14b8a6", // teal
  "#84cc16", // lime
];

export function getWorkflowColor(index: number): string {
  return WORKFLOW_COLORS[index % WORKFLOW_COLORS.length] ?? "#a3a3a3";
}

export async function fetchUnifiedCanvas(
  minExecutions: number = 2
): Promise<ApiResponse<UnifiedCanvasData>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/canvas?min_executions=${encodeURIComponent(minExecutions)}`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    const result = await handleJsonResponse<{
      workflows: Workflow[];
      nodes: RawCanvasNode[];
      edges: WorkflowCanvasEdge[];
      shared_actions: string[];
    }>(response, "fetch unified canvas");
    if (result.error || !result.data) {
      return { data: null, error: result.error };
    }

    const raw = result.data;

    // Build workflow_id -> color map
    const wfColorMap: Record<string, string> = {};
    raw.workflows.forEach((wf: Workflow, idx: number) => {
      wfColorMap[wf.id] = getWorkflowColor(idx);
    });

    const sharedSet = new Set(raw.shared_actions ?? []);

    // Transform nodes with workflow color info
    const nodes: WorkflowCanvasNode[] = (raw.nodes ?? []).map((n: RawCanvasNode) => {
      const d = n.data ?? {};
      const wfId = (d as Record<string, unknown>).workflow_id as string | undefined;
      const wfName = (d as Record<string, unknown>).workflow_name as string | undefined;
      const color = wfId ? wfColorMap[wfId] ?? "#a3a3a3" : "#a3a3a3";
      return {
        id: n.id,
        type: n.type ?? "workflowStep",
        position: n.position ?? { x: 0, y: 0 },
        data: {
          step: {
            id: n.id,
            position: d.position ?? 0,
            name: d.name ?? d.canonical_action ?? "Step",
            description: d.description ?? "",
            status: (d.status as "completed" | "failed" | "skipped") ?? "completed",
            duration_ms: d.avg_duration_ms ?? d.duration_ms ?? 0,
            canonical_action: d.canonical_action ?? "",
            created_at: d.created_at ?? "",
          },
          executionCount: d.frequency ?? d.executionCount ?? 0,
          totalExecutions: d.total_executions ?? d.totalExecutions ?? 0,
          isGoldenPath: d.isGoldenPath ?? false,
          workflowId: wfId,
          workflowName: wfName,
          workflowColor: color,
          isSharedAction: sharedSet.has(d.canonical_action ?? ""),
          nodeType: (() => {
            const nt = (d as Record<string, unknown>).node_type as string | undefined;
            return nt === "input" || nt === "compute" || nt === "output" ? nt : "compute";
          })(),
          inputSource: (() => {
            const is = (d as Record<string, unknown>).input_source as string | undefined;
            return is === "human" || is === "agent" ? is : null;
          })(),
          derivedSkillSlug: d.derived_skill_slug,
          derivedSkillName: d.derived_skill_slug,
        },
      };
    });

    // Add workflow color to edges
    // Backend returns snake_case `workflow_id`; normalize to camelCase `workflowId`
    const edges: WorkflowCanvasEdge[] = (raw.edges ?? []).map((e: WorkflowCanvasEdge) => {
      const rawData = e.data as Record<string, unknown> | undefined;
      const edgeWfId = (rawData?.workflowId ?? rawData?.workflow_id) as string | undefined;
      const color = edgeWfId ? wfColorMap[edgeWfId] ?? "#a3a3a3" : "#a3a3a3";
      return {
        ...e,
        data: {
          ...e.data,
          workflowId: edgeWfId,
          workflowColor: color,
        },
      };
    });

    // Add labels to edges: frequency on all, goal name on first edge per workflow
    // Build a set of edges that are "first" (outgoing from root nodes) per workflow
    const incomingFromOthers = new Set<string>();
    for (const e of edges) {
      if (e.source !== e.target) {
        incomingFromOthers.add(e.target);
      }
    }
    const wfNodeIds: Record<string, string[]> = {};
    for (const node of nodes) {
      const wid = node.data.workflowId;
      if (wid) {
        (wfNodeIds[wid] ??= []).push(node.id);
      }
    }
    const outDegree: Record<string, number> = {};
    for (const e of edges) {
      if (e.source !== e.target) {
        outDegree[e.source] = (outDegree[e.source] ?? 0) + 1;
      }
    }
    // Find root node per workflow (for labeling its outgoing edges with goal name)
    const wfRootSet = new Set<string>();
    for (const [wid, nodeIds] of Object.entries(wfNodeIds)) {
      const roots = nodeIds.filter((id) => !incomingFromOthers.has(id));
      if (roots.length > 0) {
        roots.forEach((r) => wfRootSet.add(r));
      } else {
        const sorted = [...nodeIds].sort((a, b) => (outDegree[b] ?? 0) - (outDegree[a] ?? 0));
        wfRootSet.add(sorted[0] ?? nodeIds[0] ?? "");
      }
    }
    // Build workflow name map
    const wfNameMap: Record<string, string> = {};
    for (const wf of raw.workflows) {
      wfNameMap[wf.id] = wf.name;
    }
    // Add labels to edges: prefer edge_type, fallback to goal, then workflow name
    const wfGoalLabeled = new Set<string>();
    for (const edge of edges) {
      const wfId = edge.data?.workflowId;
      const isSelfLoop = edge.source === edge.target;
      const rawData = edge.data as Record<string, unknown> | undefined;
      const edgeType = (rawData?.edge_type as string) ?? "";
      const edgeGoal = (rawData?.goal as string) ?? "";

      let label = "";
      if (edgeType && edgeType !== "NEXT") {
        // Show the relationship type as a readable label
        label = edgeType.replace(/_/g, " ").toLowerCase()
          .replace(/\b\w/g, (c) => c.toUpperCase());
      } else if (edgeGoal) {
        label = edgeGoal;
      } else if (
        wfId &&
        !isSelfLoop &&
        wfRootSet.has(edge.source) &&
        !wfGoalLabeled.has(wfId)
      ) {
        label = wfNameMap[wfId] ?? "";
        wfGoalLabeled.add(wfId);
      }
      if (label) {
        edge.data = { ...edge.data, label };
      }
    }

    const data: UnifiedCanvasData = {
      workflows: raw.workflows,
      nodes,
      edges,
      sharedActions: raw.shared_actions ?? [],
    };

    return { data, error: null };
  } catch (error) {
    console.error("Error fetching unified canvas:", error);
    return { data: null, error: "Error fetching unified canvas" };
  }
}

export async function fetchWorkflowDetail(
  workflowId: string
): Promise<ApiResponse<WorkflowCanvasData>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/${encodeURIComponent(workflowId)}`,
      {
        method: "GET",
        credentials: "include",
      }
    );
      const result = await handleJsonResponse<{
      workflow: Workflow;
      executions: Execution[];
      nodes: RawCanvasNode[];
      edges: WorkflowCanvasEdge[];
    }>(response, "fetch workflow detail");
    if (result.error || !result.data) {
      return { data: null, error: result.error };
    }

    // Transform backend data shape to frontend WorkflowCanvasData
    const raw = result.data;
    const canvasData: WorkflowCanvasData = {
      workflow: raw.workflow,
      executions: raw.executions ?? [],
      nodes: transformCanvasNodes(raw.nodes ?? []),
      edges: raw.edges ?? [],
    };
    return { data: canvasData, error: null };
  } catch (error) {
    console.error("Error fetching workflow detail:", error);
    return { data: null, error: "Error fetching workflow detail" };
  }
}

export async function fetchExecutionDetail(
  executionId: string
): Promise<ApiResponse<ExecutionDetail>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/execution/${encodeURIComponent(executionId)}`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return handleJsonResponse<ExecutionDetail>(
      response,
      "fetch execution detail"
    );
  } catch (error) {
    console.error("Error fetching execution detail:", error);
    return { data: null, error: "Error fetching execution detail" };
  }
}

export async function fetchStepRawSteps(
  stepId: string
): Promise<ApiResponse<RawStep[]>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/step/${encodeURIComponent(stepId)}/raw`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return handleJsonResponse<RawStep[]>(response, "fetch step raw steps");
  } catch (error) {
    console.error("Error fetching step raw steps:", error);
    return { data: null, error: "Error fetching step raw steps" };
  }
}

export async function fetchAlternatives(
  workflowId: string,
  canonicalAction: string
): Promise<ApiResponse<AlternativeApproach[]>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/${encodeURIComponent(workflowId)}/alternatives/${encodeURIComponent(canonicalAction)}`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return handleJsonResponse<AlternativeApproach[]>(
      response,
      "fetch alternatives"
    );
  } catch (error) {
    console.error("Error fetching alternatives:", error);
    return { data: null, error: "Error fetching alternatives" };
  }
}

export async function fetchGoldenPath(
  workflowId: string
): Promise<ApiResponse<GoldenPath[]>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/${encodeURIComponent(workflowId)}/golden-path`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return handleJsonResponse<GoldenPath[]>(response, "fetch golden path");
  } catch (error) {
    console.error("Error fetching golden path:", error);
    return { data: null, error: "Error fetching golden path" };
  }
}

export async function submitAnnotation(
  targetType: AnnotationTargetType,
  targetId: string,
  annotation: AnnotationInput
): Promise<ApiResponse<Annotation>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/annotate`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(annotation),
      }
    );
    return handleJsonResponse<Annotation>(response, "submit annotation");
  } catch (error) {
    console.error("Error submitting annotation:", error);
    return { data: null, error: "Error submitting annotation" };
  }
}

export async function fetchAnnotations(
  targetType: AnnotationTargetType,
  targetId: string
): Promise<ApiResponse<Annotation[]>> {
  try {
    const response = await fetch(
      `${WORKFLOW_API_BASE}/${encodeURIComponent(targetType)}/${encodeURIComponent(targetId)}/annotations`,
      {
        method: "GET",
        credentials: "include",
      }
    );
    return handleJsonResponse<Annotation[]>(response, "fetch annotations");
  } catch (error) {
    console.error("Error fetching annotations:", error);
    return { data: null, error: "Error fetching annotations" };
  }
}

export async function checkWorkflowHealth(): Promise<ApiResponse<boolean>> {
  try {
    const response = await fetch(`${WORKFLOW_API_BASE}/health`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      return { data: false, error: `Health check failed: ${response.status}` };
    }

    return { data: true, error: null };
  } catch (error) {
    console.error("Error checking workflow health:", error);
    return { data: false, error: "Error checking workflow health" };
  }
}
