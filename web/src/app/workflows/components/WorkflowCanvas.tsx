"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  applyNodeChanges,
  type Node,
  type Edge,
  type NodeMouseHandler,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { cn } from "@/lib/utils";
import type {
  WorkflowCanvasData,
  UnifiedCanvasData,
  WorkflowNodeData,
  WorkflowStep,
} from "@/lib/workflow/types";
import { computeLayout } from "./useAutoLayout";
import { WorkflowNode } from "./WorkflowNode";
import { SkillGroupNode } from "./SkillGroupNode";
import { WorkflowEdge, defaultWorkflowEdgeOptions } from "./WorkflowEdge";

/* ------------------------------------------------------------------ */
/*  Custom node & edge type registrations                              */
/* ------------------------------------------------------------------ */

const nodeTypes = {
  workflowStep: WorkflowNode,
  skillGroup: SkillGroupNode,
};

const edgeTypes = {
  workflowEdge: WorkflowEdge,
};

/* ------------------------------------------------------------------ */
/*  Skill group node logic                                             */
/* ------------------------------------------------------------------ */

const NODE_WIDTH = 240;
const NODE_HEIGHT = 90;
const GROUP_PADDING = 30;

/**
 * After Dagre layout, wrap workflows that have `derivedSkillSlug` in a
 * dotted-border group node.  Group (parent) nodes are inserted before
 * their children so React Flow renders them in the correct z-order.
 */
function addSkillGroupNodes(layoutNodes: Node[]): Node[] {
  // 1. Bucket nodes by workflowId
  const workflowBuckets = new Map<string, Node<WorkflowNodeData>[]>();
  const ungrouped: Node[] = [];

  for (const node of layoutNodes) {
    const wfId = (node.data as WorkflowNodeData | undefined)?.workflowId;
    if (wfId) {
      if (!workflowBuckets.has(wfId)) workflowBuckets.set(wfId, []);
      workflowBuckets.get(wfId)!.push(node as Node<WorkflowNodeData>);
    } else {
      ungrouped.push(node);
    }
  }

  // 2. For each workflow, decide whether to wrap in a skill group
  const result: Node[] = [];

  for (const [wfId, wfNodes] of Array.from(workflowBuckets.entries())) {
    const firstData = wfNodes[0]?.data as WorkflowNodeData | undefined;
    const skillSlug = firstData?.derivedSkillSlug;

    if (!skillSlug) {
      // No skill — keep nodes as-is
      result.push(...wfNodes);
      continue;
    }

    // Calculate bounding box
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of wfNodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.position.y + NODE_HEIGHT);
    }

    const groupId = `skill-group-${wfId}`;
    const groupWidth = maxX - minX + GROUP_PADDING * 2;
    const groupHeight = maxY - minY + GROUP_PADDING * 2;

    // Push the group node FIRST (React Flow requires parents before children)
    result.push({
      id: groupId,
      type: "skillGroup",
      position: { x: minX - GROUP_PADDING, y: minY - GROUP_PADDING },
      data: {
        skillSlug,
        skillName: firstData?.derivedSkillName || skillSlug,
        workflowColor: firstData?.workflowColor || "#a3a3a3",
      },
      style: { width: groupWidth, height: groupHeight },
      draggable: false,
      selectable: false,
    });

    // Make child node positions relative to the group
    for (const n of wfNodes) {
      result.push({
        ...n,
        parentId: groupId,
        extent: "parent" as const,
        position: {
          x: n.position.x - minX + GROUP_PADDING,
          y: n.position.y - minY + GROUP_PADDING,
        },
      });
    }
  }

  // 3. Append nodes without a workflowId
  result.push(...ungrouped);

  return result;
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface WorkflowCanvasProps {
  canvasData: WorkflowCanvasData | UnifiedCanvasData;
  className?: string;
  focusedWorkflowId?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Inner canvas (must be wrapped in ReactFlowProvider)                */
/* ------------------------------------------------------------------ */

function WorkflowCanvasInner({ canvasData, className, focusedWorkflowId }: WorkflowCanvasProps) {
  const [selectedStep, setSelectedStep] = useState<WorkflowStep | null>(null);
  const [annotationStatus, setAnnotationStatus] = useState<string | null>(null);
  const reactFlowInstance = useReactFlow();
  const prevDataRef = useRef<typeof canvasData>(null);

  // Convert canvas data to React Flow edges (stable across drags)
  const edges: Edge[] = useMemo(
    () =>
      canvasData.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: e.type,
        data: e.data ?? {},
      })),
    [canvasData.edges]
  );

  // Compute layout ONCE when canvasData changes, then store in state
  const [nodes, setNodes] = useState<Node<WorkflowNodeData>[]>([]);

  useEffect(() => {
    if (canvasData === prevDataRef.current) return;
    prevDataRef.current = canvasData;

    const rawNodes: Node<WorkflowNodeData>[] = canvasData.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
    }));

    const edgesForLayout: Edge[] = canvasData.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: e.type,
    }));

    const laid = computeLayout(rawNodes, edgesForLayout, "LR") as Node<WorkflowNodeData>[];

    // Wrap skill-derived workflows in dotted group nodes
    const grouped = addSkillGroupNodes(laid);
    setNodes(grouped as Node<WorkflowNodeData>[]);
  }, [canvasData]);

  // Let React Flow handle drag / position changes
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((nds) => applyNodeChanges(changes, nds) as Node<WorkflowNodeData>[]);
  }, []);

  // Focus on a specific workflow's nodes when focusedWorkflowId changes
  useEffect(() => {
    if (!focusedWorkflowId || nodes.length === 0) return;

    const timer = setTimeout(() => {
      const targetNodes = nodes.filter((n) => {
        const data = n.data as WorkflowNodeData;
        return data.workflowId === focusedWorkflowId;
      });

      if (targetNodes.length > 0) {
        reactFlowInstance.fitView({
          nodes: targetNodes.map((n) => ({ id: n.id })),
          padding: 0.3,
          duration: 400,
        });
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [focusedWorkflowId, nodes, reactFlowInstance]);

  // Handle node click
  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const nodeData = node.data as WorkflowNodeData | undefined;
      if (nodeData?.step) {
        setSelectedStep(nodeData.step);
      }
    },
    []
  );

  const handleClosePanel = useCallback(() => {
    setSelectedStep(null);
    setAnnotationStatus(null);
  }, []);

  const handleAnnotation = useCallback(
    async (stepId: string, label: string) => {
      try {
        const response = await fetch(`/api/workflow/step/${stepId}/annotate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            name: "quality",
            label: label,
            score: label === "thumbs_up" ? 5.0 : 1.0,
          }),
        });
        if (response.ok) {
          setAnnotationStatus(label === "thumbs_up" ? "positive" : "negative");
          setTimeout(() => setAnnotationStatus(null), 2000);
        }
      } catch (error) {
        console.error("Failed to submit annotation:", error);
      }
    },
    []
  );

  return (
    <div className={cn("relative w-full h-full", className)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        defaultEdgeOptions={defaultWorkflowEdgeOptions}
        onNodeClick={onNodeClick}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable
        nodesConnectable={false}
        edgesReconnectable={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={16}
          size={1}
          className="!bg-neutral-50 dark:!bg-neutral-950"
        />
        <Controls
          showInteractive={false}
          className="!bg-white dark:!bg-neutral-800 !border-neutral-200 dark:!border-neutral-700 !shadow-sm [&>button]:!bg-white dark:[&>button]:!bg-neutral-800 [&>button]:!border-neutral-200 dark:[&>button]:!border-neutral-700 [&>button]:!text-neutral-700 dark:[&>button]:!text-neutral-300"
        />
        <MiniMap
          nodeColor={(node) => {
            const data = node.data as WorkflowNodeData | undefined;
            if (data?.workflowColor) return data.workflowColor;
            if (!data?.step) return "#d4d4d4";
            switch (data.step.status) {
              case "completed":
                return "#22c55e";
              case "failed":
                return "#ef4444";
              case "skipped":
                return "#a3a3a3";
              default:
                return "#d4d4d4";
            }
          }}
          maskColor="rgba(0, 0, 0, 0.1)"
          className="!bg-white dark:!bg-neutral-900 !border-neutral-200 dark:!border-neutral-700"
        />
      </ReactFlow>

      {/* Simple info panel */}
      {selectedStep && (
        <div className="absolute inset-y-0 right-0 z-50 w-[320px] max-w-[90vw] flex flex-col bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-700 shadow-xl animate-in slide-in-from-right duration-200">
          <div className="flex items-start gap-3 p-4 border-b border-neutral-200 dark:border-neutral-700">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                {selectedStep.name}
              </h2>
              {selectedStep.canonical_action && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono mt-1 block">
                  {selectedStep.canonical_action}
                </span>
              )}
            </div>
            <button
              onClick={handleClosePanel}
              className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </button>
          </div>
          {selectedStep.description && (
            <div className="p-4">
              <p className="text-sm text-neutral-600 dark:text-neutral-300 leading-relaxed">
                {selectedStep.description}
              </p>
            </div>
          )}

          {/* Feedback Section */}
          <div className="p-4 border-t border-neutral-200 dark:border-neutral-700">
            <h3 className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">
              Feedback
            </h3>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => handleAnnotation(selectedStep.id, "thumbs_up")}
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border transition-colors",
                  annotationStatus === "positive"
                    ? "border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300"
                    : "border-neutral-200 dark:border-neutral-600 hover:bg-green-50 dark:hover:bg-green-900/20"
                )}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2h0a3.13 3.13 0 0 1 3 3.88Z"/></svg>
                Helpful
              </button>
              <button
                onClick={() => handleAnnotation(selectedStep.id, "thumbs_down")}
                className={cn(
                  "flex items-center gap-1 px-3 py-1.5 rounded-md text-sm border transition-colors",
                  annotationStatus === "negative"
                    ? "border-red-500 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
                    : "border-neutral-200 dark:border-neutral-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                )}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L14 22h0a3.13 3.13 0 0 1-3-3.88Z"/></svg>
                Unhelpful
              </button>
            </div>
            {annotationStatus && (
              <p className={cn(
                "text-xs",
                annotationStatus === "positive"
                  ? "text-green-600 dark:text-green-400"
                  : "text-red-600 dark:text-red-400"
              )}>
                Feedback submitted. Thank you!
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Public component (with provider wrapper)                           */
/* ------------------------------------------------------------------ */

export function WorkflowCanvas({ canvasData, className, focusedWorkflowId }: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner
        canvasData={canvasData}
        className={className}
        focusedWorkflowId={focusedWorkflowId}
      />
    </ReactFlowProvider>
  );
}
