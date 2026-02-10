"use client";

import { useEffect } from "react";
import Button from "@/refresh-components/buttons/Button";
import { Label } from "@/components/ui/label";

/**
 * Props for the InlineToolApproval component.
 */
export interface InlineToolApprovalProps {
  toolName: string;
  toolInput: Record<string, unknown>;
  toolCallId: string;
  operationHash: string;
  onApprove: (toolCallId: string, alwaysAllow: boolean, operationHash?: string) => void;
  onDeny: (toolCallId: string) => void;
}

/**
 * Tool descriptions for display in the approval UI.
 */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  write_file: "Write content to a file (will create or overwrite)",
  edit_file: "Edit a file by replacing text",
  bash: "Execute a shell command",
};

/**
 * Get a human-readable description for a tool.
 */
function getToolDescription(toolName: string): string {
  return (
    TOOL_DESCRIPTIONS[toolName] ||
    `Execute the ${toolName} tool with the parameters shown below`
  );
}

/**
 * InlineToolApproval - Inline approval UI for tool execution.
 *
 * Appears inline in the chat flow when a tool requires user approval.
 */
export function InlineToolApproval({
  toolName,
  toolInput,
  toolCallId,
  operationHash,
  onApprove,
  onDeny,
}: InlineToolApprovalProps) {
  const handleApproveOnce = () => {
    onApprove(toolCallId, false);
  };

  const handleApproveAlways = () => {
    onApprove(toolCallId, true, operationHash);
  };

  const handleDeny = () => {
    onDeny(toolCallId);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if no input is focused
      if (
        document.activeElement?.tagName === "INPUT" ||
        document.activeElement?.tagName === "TEXTAREA"
      ) {
        return;
      }

      // Escape = Deny
      if (e.key === "Escape") {
        e.preventDefault();
        handleDeny();
        return;
      }

      // Enter = Allow once
      if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleApproveOnce();
        return;
      }

      // Cmd+Enter (Mac) or Ctrl+Enter (Win/Linux) = Always allow
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleApproveAlways();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toolCallId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3" data-testid="bottom-tool-approval">
      {/* Tool info header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Allow Bud to execute {toolName}? </h3>
        {/* <span className="text-sm text-text-subtle">The agent wants to execute: <code className="px-1.5 py-0.5 bg-background-emphasis rounded font-mono text-xs">{toolName}</code></span> */}
      </div>

      <div className="space-y-2">
        {/* Tool description */}
        {/* <div className="space-y-1">
          <Label className="text-text-subtle text-xs uppercase tracking-wide">
            Description
          </Label>
          <p className="text-sm">{getToolDescription(toolName)}</p>
        </div> */}

        {/* Tool input parameters */}
        <div className="space-y-1">
          {/* <Label className="text-text-subtle text-xs uppercase tracking-wide">
            Input Parameters
          </Label> */}
          <pre className="p-3 text-xs font-mono rounded overflow-auto max-h-40 border border-border" style={{ backgroundColor: '#222222' }}>
            {JSON.stringify(toolInput, null, 2)}
          </pre>
        </div>

      </div>

      {/* Action buttons */}
      <div className="flex gap-2 justify-end">
        <Button
          secondary
          onClick={handleDeny}
          className="min-w-[100px] border border-border !rounded-md"
          data-testid="bottom-tool-approval-deny"
        >
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-xs bg-black rounded border border-border font-mono">ESC</kbd>
            Deny
          </span>
        </Button>
        <Button
          secondary
          onClick={handleApproveAlways}
          className="min-w-[120px] !rounded-md"
          data-testid="bottom-tool-approval-always-allow"
        >
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-xs bg-black rounded border border-border font-mono">
              {typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}
            </kbd>
            <kbd className="px-1.5 py-0.5 text-xs bg-black rounded border border-border font-mono">
              ⏎
            </kbd>
            Always allow
          </span>
        </Button>
        <Button
          action
          onClick={handleApproveOnce}
          className="min-w-[120px] !bg-purple-600 hover:!bg-purple-700 !rounded-md"
          data-testid="bottom-tool-approval-allow-once"
        >
          <span className="flex items-center gap-2">
            <kbd className="px-1.5 py-0.5 text-xs bg-purple text-white rounded border border-border border-grey font-mono">⏎</kbd>
            Allow once
          </span>
        </Button>
      </div>
    </div>
  );
}

export default InlineToolApproval;
