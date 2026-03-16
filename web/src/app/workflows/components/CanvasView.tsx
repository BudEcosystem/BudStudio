"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchUnifiedCanvas, getWorkflowColor } from "@/lib/workflow/api";
import { Workflow, UnifiedCanvasData } from "@/lib/workflow/types";
import { WorkflowCanvas } from "@/app/workflows/components/WorkflowCanvas";
import { cn } from "@/lib/utils";
import { List, X } from "lucide-react";

function WorkflowSidebarCard({
  workflow,
  index,
  isActive,
  onSelect,
}: {
  workflow: Workflow;
  index: number;
  isActive: boolean;
  onSelect: (workflow: Workflow) => void;
}) {
  const color = getWorkflowColor(index);
  const successPct = Math.round(workflow.success_rate * 100);

  return (
    <button
      onClick={() => onSelect(workflow)}
      className={cn(
        "w-full text-left px-3 py-2.5 rounded-lg border transition-all",
        isActive
          ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
          : "border-transparent hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: color }}
        />
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate">
          {workflow.name}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1 ml-[18px] text-xs text-neutral-500 dark:text-neutral-400">
        <span>
          {workflow.execution_count}{" "}
          {workflow.execution_count === 1 ? "run" : "runs"}
        </span>
        <span className="text-neutral-300 dark:text-neutral-600">|</span>
        <span
          className={cn(
            successPct >= 80
              ? "text-green-600 dark:text-green-400"
              : successPct >= 50
                ? "text-yellow-600 dark:text-yellow-400"
                : "text-red-600 dark:text-red-400"
          )}
        >
          {successPct}%
        </span>
      </div>
    </button>
  );
}

/**
 * Shared canvas + sidebar component used by the workflows list page,
 * the workflow detail page, and the desktop WorkflowsView.
 *
 * @param initialFocusedWorkflowId  - When provided the canvas opens
 *   focused on that workflow. Omit (or pass ``undefined``) to show all.
 * @param onWorkflowNavigate - Optional callback invoked when the user
 *   selects a different workflow or clicks "Show All". Receives the new
 *   workflow id (or ``null`` for "show all"). The caller can use this
 *   to update the URL without duplicating canvas logic.
 * @param testId - data-testid for the root element.
 * @param emptyMessage - Custom message shown when there is no data.
 * @param showEmptyIcon - Whether to show the decorative icon in the
 *   empty state (default ``true``).
 */
export function CanvasView({
  initialFocusedWorkflowId,
  onWorkflowNavigate,
  testId = "canvas-view",
  emptyMessage = "No repeated tasks yet. As you use the agent for similar tasks, canvas items will appear here.",
  showEmptyIcon = true,
}: {
  initialFocusedWorkflowId?: string | null;
  onWorkflowNavigate?: (workflowId: string | null) => void;
  testId?: string;
  emptyMessage?: string;
  showEmptyIcon?: boolean;
}) {
  const [canvasData, setCanvasData] = useState<UnifiedCanvasData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focusedWorkflowId, setFocusedWorkflowId] = useState<string | null>(
    initialFocusedWorkflowId ?? null
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadCanvas = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchUnifiedCanvas(2);
      if (result.error) {
        setError(result.error);
      } else if (result.data) {
        setCanvasData(result.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load canvas");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCanvas();
  }, [loadCanvas]);

  const handleSelectWorkflow = useCallback(
    (workflow: Workflow) => {
      const newId =
        focusedWorkflowId === workflow.id ? null : workflow.id;
      setFocusedWorkflowId(newId);
      onWorkflowNavigate?.(newId);
    },
    [focusedWorkflowId, onWorkflowNavigate]
  );

  const handleShowAll = useCallback(() => {
    setFocusedWorkflowId(null);
    onWorkflowNavigate?.(null);
  }, [onWorkflowNavigate]);

  const workflows = canvasData?.workflows ?? [];
  const hasWorkflows = !isLoading && workflows.length > 0;

  return (
    <div
      className="flex-1 h-full relative overflow-hidden"
      data-testid={testId}
    >
      {error && (
        <div className="absolute top-3 left-3 right-3 z-20 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-between">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          <button
            onClick={loadCanvas}
            className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 ml-3 shrink-0 underline"
          >
            Retry
          </button>
        </div>
      )}

      {hasWorkflows && (
        <button
          onClick={() => setSidebarOpen((v) => !v)}
          className={cn(
            "absolute top-3 right-3 z-20 p-2 rounded-lg shadow-md border transition-colors",
            sidebarOpen
              ? "bg-neutral-100 dark:bg-neutral-800 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
              : "bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-500 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800"
          )}
          title={sidebarOpen ? "Hide workflows" : "Show workflows"}
        >
          {sidebarOpen ? (
            <X className="h-4 w-4" />
          ) : (
            <List className="h-4 w-4" />
          )}
        </button>
      )}

      {hasWorkflows && sidebarOpen && (
        <div className="absolute top-14 right-3 z-20 w-[260px] max-h-[calc(100%-70px)] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-lg overflow-y-auto p-3 space-y-1">
          <button
            onClick={handleShowAll}
            className={cn(
              "w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all",
              !focusedWorkflowId
                ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100"
                : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
            )}
          >
            Show All
          </button>
          <div className="h-px bg-neutral-200 dark:bg-neutral-700 my-2" />
          {workflows.map((workflow, idx) => (
            <WorkflowSidebarCard
              key={workflow.id}
              workflow={workflow}
              index={idx}
              isActive={focusedWorkflowId === workflow.id}
              onSelect={handleSelectWorkflow}
            />
          ))}
        </div>
      )}

      {isLoading && (
        <div className="h-full flex items-center justify-center">
          <p className="text-sm text-text-02">Loading canvas...</p>
        </div>
      )}

      {!isLoading && !error && canvasData && canvasData.nodes.length > 0 && (
        <WorkflowCanvas
          canvasData={canvasData}
          className="h-full w-full"
          focusedWorkflowId={focusedWorkflowId}
        />
      )}

      {!isLoading &&
        !error &&
        (!canvasData || canvasData.nodes.length === 0) && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            {showEmptyIcon && (
              <div className="w-16 h-16 rounded-full bg-background-neutral-03 flex items-center justify-center mb-4">
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className="w-8 h-8 stroke-text-02"
                >
                  <path
                    d="M2.79986 5.60004C2.61157 5.85073 2.5 6.16234 2.5 6.5V11.9754C2.5 13.203 4.08461 13.6951 4.78005 12.6836L11.2199 3.31644C11.9154 2.30488 13.5 2.79705 13.5 4.0246V9.5C13.5 9.83766 13.3884 10.1493 13.2001 10.4M2.79986 5.60004C3.13415 5.85118 3.54969 6 4 6C5.10457 6 6 5.10457 6 4C6 2.89543 5.10457 2 4 2C2.89543 2 2 2.89543 2 4C2 4.65426 2.31416 5.23515 2.79986 5.60004ZM13.2001 10.4C12.8659 10.1488 12.4503 10 12 10C10.8954 10 10 10.8954 10 12C10 13.1046 10.8954 14 12 14C13.1046 14 14 13.1046 14 12C14 11.3457 13.6858 10.7648 13.2001 10.4Z"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
            <p className="text-sm text-text-02 max-w-sm">{emptyMessage}</p>
          </div>
        )}
    </div>
  );
}
