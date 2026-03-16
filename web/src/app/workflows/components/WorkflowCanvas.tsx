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
import { WorkflowEdge, defaultWorkflowEdgeOptions } from "./WorkflowEdge";

/* ------------------------------------------------------------------ */
/*  Custom node & edge type registrations                              */
/* ------------------------------------------------------------------ */

const nodeTypes = {
  workflowStep: WorkflowNode,
};

const edgeTypes = {
  workflowEdge: WorkflowEdge,
};

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
    setNodes(laid);
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
  }, []);

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
