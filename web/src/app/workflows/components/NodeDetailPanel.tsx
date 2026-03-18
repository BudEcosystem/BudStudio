"use client";

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Clock,
  CheckCircle,
  XCircle,
  MinusCircle,
  Star,
  Wrench,
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchStepRawSteps, submitAnnotation, fetchAnnotations } from "@/lib/workflow/api";
import type {
  WorkflowStep,
  RawStep,
  Annotation,
  AnnotationInput,
} from "@/lib/workflow/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface NodeDetailPanelProps {
  step: WorkflowStep;
  onClose: () => void;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "completed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-300">
          <CheckCircle className="h-3 w-3" />
          Completed
        </span>
      );
    case "failed":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 dark:bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
    case "skipped":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-neutral-400">
          <MinusCircle className="h-3 w-3" />
          Skipped
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 dark:bg-neutral-800 px-2 py-0.5 text-xs font-medium text-gray-600 dark:text-neutral-400">
          {status}
        </span>
      );
  }
}

function ToolSourceBadge({ source }: { source: string }) {
  const colorMap: Record<string, string> = {
    local: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
    remote: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
    mcp: "bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300",
    connector: "bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        colorMap[source] ?? "bg-gray-50 text-gray-700 dark:bg-neutral-800 dark:text-neutral-300"
      )}
    >
      {source}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Raw Step Row                                                       */
/* ------------------------------------------------------------------ */

function RawStepRow({ rawStep }: { rawStep: RawStep }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-neutral-200 dark:border-neutral-700 rounded-md overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
        )}
        <Wrench className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400 shrink-0" />
        <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate flex-1">
          {rawStep.tool_name}
        </span>
        <ToolSourceBadge source={rawStep.tool_source} />
        <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">
          {formatDuration(rawStep.duration_ms)}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-neutral-200 dark:border-neutral-700 px-3 py-2 space-y-2">
          {rawStep.mcp_server && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-0.5">
                MCP Server
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-300">
                {rawStep.mcp_server}
              </p>
            </div>
          )}
          <div>
            <p className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-0.5">
              Inputs
            </p>
            <pre className="text-xs text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
              {rawStep.inputs}
            </pre>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-0.5">
              Outputs
            </p>
            <pre className="text-xs text-neutral-600 dark:text-neutral-300 bg-neutral-50 dark:bg-neutral-800 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
              {rawStep.outputs}
            </pre>
          </div>
          {rawStep.error && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-red-400 dark:text-red-500 mb-0.5">
                Error
              </p>
              <pre className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/20 rounded p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
                {rawStep.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Star Rating                                                        */
/* ------------------------------------------------------------------ */

function StarRating({
  value,
  onChange,
  readonly = false,
}: {
  value: number;
  onChange?: (value: number) => void;
  readonly?: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => onChange?.(star)}
          className={cn(
            "transition-colors",
            readonly ? "cursor-default" : "cursor-pointer hover:scale-110"
          )}
        >
          <Star
            className={cn(
              "h-5 w-5",
              star <= value
                ? "fill-amber-400 text-amber-400"
                : "fill-none text-neutral-300 dark:text-neutral-600"
            )}
          />
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Annotation Row                                                     */
/* ------------------------------------------------------------------ */

function AnnotationRow({ annotation }: { annotation: Annotation }) {
  return (
    <div className="border-b border-neutral-100 dark:border-neutral-800 py-2 last:border-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
          {annotation.name}
        </span>
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500">
          {annotation.annotator_kind}
        </span>
      </div>
      {annotation.score !== null && (
        <StarRating value={annotation.score} readonly />
      )}
      {annotation.comment && (
        <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-1">
          {annotation.comment}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Panel                                                         */
/* ------------------------------------------------------------------ */

export function NodeDetailPanel({ step, onClose }: NodeDetailPanelProps) {
  // Raw steps
  const [rawSteps, setRawSteps] = useState<RawStep[]>([]);
  const [loadingRawSteps, setLoadingRawSteps] = useState(false);
  const [rawStepsError, setRawStepsError] = useState<string | null>(null);

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [loadingAnnotations, setLoadingAnnotations] = useState(false);

  // Annotation form
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Fetch raw steps on mount / step change
  useEffect(() => {
    let cancelled = false;
    setLoadingRawSteps(true);
    setRawStepsError(null);

    fetchStepRawSteps(step.id).then((res) => {
      if (cancelled) return;
      setLoadingRawSteps(false);
      if (res.error) {
        setRawStepsError(res.error);
      } else {
        setRawSteps(res.data ?? []);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [step.id]);

  // Fetch annotations on mount / step change
  useEffect(() => {
    let cancelled = false;
    setLoadingAnnotations(true);

    fetchAnnotations("step", step.id).then((res) => {
      if (cancelled) return;
      setLoadingAnnotations(false);
      if (res.data) {
        setAnnotations(res.data);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [step.id]);

  const handleSubmitAnnotation = useCallback(async () => {
    if (rating === 0 && !comment.trim()) return;

    setSubmitting(true);
    setSubmitError(null);

    const input: AnnotationInput = {
      name: "User Feedback",
      ...(rating > 0 ? { score: rating } : {}),
      ...(comment.trim() ? { comment: comment.trim() } : {}),
    };

    const res = await submitAnnotation("step", step.id, input);
    setSubmitting(false);

    if (res.error) {
      setSubmitError(res.error);
    } else if (res.data) {
      setAnnotations((prev) => [res.data!, ...prev]);
      setRating(0);
      setComment("");
    }
  }, [rating, comment, step.id]);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[400px] max-w-[90vw] flex flex-col bg-white dark:bg-neutral-900 border-l border-neutral-200 dark:border-neutral-700 shadow-xl animate-in slide-in-from-right duration-200">
      {/* Header */}
      <div className="flex items-start gap-3 p-4 border-b border-neutral-200 dark:border-neutral-700 shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100 truncate">
            {step.name}
          </h2>
          {step.description && (
            <p className="text-sm text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-2">
              {step.description}
            </p>
          )}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <StatusBadge status={step.status} />
            <span className="inline-flex items-center gap-1 text-xs text-neutral-500 dark:text-neutral-400">
              <Clock className="h-3 w-3" />
              {formatDuration(step.duration_ms)}
            </span>
            {step.canonical_action && (
              <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate max-w-[140px]">
                {step.canonical_action}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors shrink-0"
        >
          <X className="h-5 w-5 text-neutral-500 dark:text-neutral-400" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        {/* Raw Steps section */}
        <div className="p-4 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
            Raw Steps ({rawSteps.length})
          </h3>

          {loadingRawSteps ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
              <span className="text-sm text-neutral-400">Loading...</span>
            </div>
          ) : rawStepsError ? (
            <div className="flex items-center gap-2 py-3 text-sm text-red-500 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{rawStepsError}</span>
            </div>
          ) : rawSteps.length === 0 ? (
            <p className="text-sm text-neutral-400 dark:text-neutral-500 py-2">
              No tool calls recorded for this step.
            </p>
          ) : (
            <div className="space-y-2">
              {rawSteps.map((rs) => (
                <RawStepRow key={rs.id} rawStep={rs} />
              ))}
            </div>
          )}
        </div>

        {/* Feedback section */}
        <div className="p-4">
          <h3 className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide mb-3">
            Feedback
          </h3>

          {/* Annotation form */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">
                Rating
              </label>
              <StarRating value={rating} onChange={setRating} />
            </div>
            <div>
              <label className="text-xs text-neutral-500 dark:text-neutral-400 mb-1 block">
                Comment
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Add feedback for this step..."
                className="w-full text-sm border border-neutral-200 dark:border-neutral-700 rounded-md px-3 py-2 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 dark:placeholder:text-neutral-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            {submitError && (
              <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {submitError}
              </p>
            )}
            <button
              onClick={handleSubmitAnnotation}
              disabled={submitting || (rating === 0 && !comment.trim())}
              className={cn(
                "w-full text-sm font-medium rounded-md px-3 py-2 transition-colors",
                "bg-blue-600 hover:bg-blue-700 text-white",
                "disabled:opacity-50 disabled:cursor-not-allowed"
              )}
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Submitting...
                </span>
              ) : (
                "Submit Feedback"
              )}
            </button>
          </div>

          {/* Existing annotations */}
          {loadingAnnotations ? (
            <div className="flex items-center gap-2 py-4 justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />
              <span className="text-sm text-neutral-400">Loading annotations...</span>
            </div>
          ) : annotations.length > 0 ? (
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500 mb-2">
                Previous Feedback
              </p>
              {annotations.map((ann) => (
                <AnnotationRow key={ann.id} annotation={ann} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
