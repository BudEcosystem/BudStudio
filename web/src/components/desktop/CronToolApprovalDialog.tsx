"use client";

import type { CronToolRequest } from "@/lib/agent/types";

interface CronToolApprovalDialogProps {
  toolRequest: CronToolRequest;
  onApprove: (executionId: string) => void;
  onDeny: (executionId: string) => void;
}

/**
 * Dialog for approving or denying a local tool request from a cron execution.
 */
export function CronToolApprovalDialog({
  toolRequest,
  onApprove,
  onDeny,
}: CronToolApprovalDialogProps) {
  return (
    <div className="p-4 rounded-lg border border-yellow-500/30 bg-yellow-500/5">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500/20 flex items-center justify-center">
          <span className="text-yellow-500 text-sm">!</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">
            Tool approval requested by{" "}
            <span className="text-foreground">
              {toolRequest.cron_job_name}
            </span>
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Tool:{" "}
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs">
              {toolRequest.tool_name}
            </code>
          </p>
          {toolRequest.tool_input && (
            <pre className="mt-2 p-2 rounded bg-muted text-xs overflow-x-auto max-h-32">
              {JSON.stringify(toolRequest.tool_input, null, 2)}
            </pre>
          )}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => onApprove(toolRequest.id)}
              className="px-3 py-1.5 text-sm rounded bg-green-600 hover:bg-green-700 text-white"
            >
              Approve
            </button>
            <button
              onClick={() => onDeny(toolRequest.id)}
              className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white"
            >
              Deny
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
