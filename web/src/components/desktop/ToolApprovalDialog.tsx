"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import Button from "@/refresh-components/buttons/Button";
import { FiAlertTriangle, FiFile, FiEdit, FiTerminal, FiCpu } from "react-icons/fi";
import {
  isMemoryFile,
  getMemoryFileDescription,
} from "@/lib/agent/utils/memory-detector";

/**
 * Props for the ToolApprovalDialog component.
 */
export interface ToolApprovalDialogProps {
  isOpen: boolean;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolCallId: string;
  operationHash: string;
  onApprove: (toolCallId: string, alwaysAllow: boolean, operationHash?: string) => void;
  onDeny: (toolCallId: string) => void;
  onClose: () => void;
}

/**
 * Tool descriptions for display in the approval dialog.
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
 * Get an icon for a tool.
 */
function getToolIcon(toolName: string, isMemory: boolean) {
  if (isMemory) {
    return <FiCpu className="w-5 h-5" />;
  }
  switch (toolName) {
    case "write_file":
      return <FiFile className="w-5 h-5" />;
    case "edit_file":
      return <FiEdit className="w-5 h-5" />;
    case "bash":
      return <FiTerminal className="w-5 h-5" />;
    default:
      return <FiAlertTriangle className="w-5 h-5" />;
  }
}

/**
 * Check if a tool input targets a memory file.
 */
function checkIsMemoryFileOperation(
  toolName: string,
  toolInput: Record<string, unknown>
): { isMemory: boolean; filePath: string | null } {
  if (toolName === "write_file" || toolName === "edit_file") {
    const filePath = toolInput.path as string | undefined;
    if (filePath && isMemoryFile(filePath)) {
      return { isMemory: true, filePath };
    }
  }
  return { isMemory: false, filePath: null };
}

/**
 * ToolApprovalDialog - Modal dialog for approving or denying tool execution.
 *
 * This component displays when a tool requires user approval before execution.
 * It shows the tool name, description, input parameters, and provides
 * approve/deny buttons.
 */
export function ToolApprovalDialog({
  isOpen,
  toolName,
  toolInput,
  toolCallId,
  operationHash,
  onApprove,
  onDeny,
  onClose,
}: ToolApprovalDialogProps) {
  // Check if this is a memory file operation
  const { isMemory, filePath: memoryFilePath } = useMemo(
    () => checkIsMemoryFileOperation(toolName, toolInput),
    [toolName, toolInput]
  );

  const memoryDescription = useMemo(
    () => (memoryFilePath ? getMemoryFileDescription(memoryFilePath) : null),
    [memoryFilePath]
  );

  const handleApproveOnce = () => {
    onApprove(toolCallId, false);
    onClose();
  };

  const handleApproveAlways = () => {
    onApprove(toolCallId, true, operationHash);
    onClose();
  };

  const handleDeny = () => {
    onDeny(toolCallId);
    onClose();
  };

  // Keyboard shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine dialog styling based on whether this is a memory operation
  const iconBgClass = isMemory
    ? "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
    : "bg-yellow-100 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-400";

  const dialogTitle = isMemory ? "Memory Update Request" : "Tool Approval Required";
  const dialogDescription = isMemory
    ? `The agent wants to ${toolName === "write_file" ? "write to" : "edit"} a memory file. Memory files store persistent context and preferences.`
    : "The agent wants to execute the following tool. Please review and approve or deny this action.";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="tool-approval-dialog">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className={`flex items-center justify-center w-10 h-10 rounded-full ${iconBgClass}`}>
              {getToolIcon(toolName, isMemory)}
            </div>
            <DialogTitle className="text-xl" data-testid="tool-approval-title">{dialogTitle}</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        {/* Tool details */}
        <div className="space-y-4 py-4">
          {/* Tool name */}
          <div className="space-y-1">
            <Label className="text-text-subtle text-xs uppercase tracking-wide">
              Tool
            </Label>
            <div className="flex items-center gap-2">
              <code className="px-2 py-1 text-sm font-mono bg-background-emphasis rounded">
                {toolName}
              </code>
            </div>
          </div>

          {/* Memory file info (if applicable) */}
          {isMemory && memoryFilePath && (
            <div className="space-y-1">
              <Label className="text-text-subtle text-xs uppercase tracking-wide">
                Memory File
              </Label>
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 text-sm font-mono bg-purple-100 dark:bg-purple-900/30 rounded">
                  {memoryFilePath}
                </code>
                {memoryDescription && (
                  <span className="text-sm text-text-subtle">
                    - {memoryDescription}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Tool description */}
          <div className="space-y-1">
            <Label className="text-text-subtle text-xs uppercase tracking-wide">
              Description
            </Label>
            <p className="text-sm">{getToolDescription(toolName)}</p>
          </div>

          {/* Tool input parameters */}
          <div className="space-y-1">
            <Label className="text-text-subtle text-xs uppercase tracking-wide">
              Input Parameters
            </Label>
            <pre className="p-3 text-xs font-mono bg-background-emphasis rounded-lg overflow-auto max-h-48 border border-border">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>

          {/* Keyboard shortcuts hint */}
          <div className="text-xs text-text-subtle pt-2 space-y-1">
            <div>Press <kbd className="px-1.5 py-0.5 bg-background-emphasis rounded border border-border font-mono">Esc</kbd> to deny</div>
            <div>Press <kbd className="px-1.5 py-0.5 bg-background-emphasis rounded border border-border font-mono">Enter</kbd> to allow once</div>
            <div>Press <kbd className="px-1.5 py-0.5 bg-background-emphasis rounded border border-border font-mono">{typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter</kbd> to always allow for this session</div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-row">
          <Button
            danger
            secondary
            onClick={handleDeny}
            className="min-w-[120px]"
            data-testid="tool-approval-deny"
          >
            Deny
          </Button>
          <Button
            secondary
            onClick={handleApproveOnce}
            className="min-w-[120px]"
            data-testid="tool-approval-allow-once"
          >
            Allow once
          </Button>
          <Button
            action
            onClick={handleApproveAlways}
            className="min-w-[120px]"
            data-testid="tool-approval-always-allow"
          >
            Always allow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ToolApprovalDialog;
