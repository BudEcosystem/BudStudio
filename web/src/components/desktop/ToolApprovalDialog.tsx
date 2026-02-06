"use client";

import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
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
  onApprove: (toolCallId: string, alwaysAllow: boolean) => void;
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
  onApprove,
  onDeny,
  onClose,
}: ToolApprovalDialogProps) {
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  // Check if this is a memory file operation
  const { isMemory, filePath: memoryFilePath } = useMemo(
    () => checkIsMemoryFileOperation(toolName, toolInput),
    [toolName, toolInput]
  );

  const memoryDescription = useMemo(
    () => (memoryFilePath ? getMemoryFileDescription(memoryFilePath) : null),
    [memoryFilePath]
  );

  const handleApprove = () => {
    onApprove(toolCallId, alwaysAllow);
    onClose();
  };

  const handleDeny = () => {
    onDeny(toolCallId);
    onClose();
  };

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

          {/* Always allow checkbox */}
          <div className="flex items-center space-x-2 pt-2">
            <Checkbox
              id="always-allow"
              checked={alwaysAllow}
              onCheckedChange={(checked) => setAlwaysAllow(checked === true)}
            />
            <Label
              htmlFor="always-allow"
              className="text-sm cursor-pointer text-text-subtle"
            >
              {isMemory
                ? "Always allow memory updates (for this session)"
                : "Always allow this tool (for this session)"}
            </Label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            danger
            secondary
            onClick={handleDeny}
            className="min-w-[100px]"
            data-testid="tool-approval-deny"
          >
            Deny
          </Button>
          <Button
            action
            onClick={handleApprove}
            className="min-w-[100px]"
            data-testid="tool-approval-approve"
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ToolApprovalDialog;
