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
import { FiCpu, FiUser, FiFile, FiDatabase } from "react-icons/fi";
import {
  generateDiff,
  getDiffStats,
  getMemoryFileDescription,
  type DiffLine,
} from "@/lib/agent/utils/memory-detector";
import { cn } from "@/lib/utils";

/**
 * Props for the MemoryUpdateDialog component.
 */
export interface MemoryUpdateDialogProps {
  /** Whether the dialog is open */
  isOpen: boolean;
  /** Path to the file being modified */
  filePath: string;
  /** The current content of the file (empty if new file) */
  oldContent: string;
  /** The proposed new content */
  newContent: string;
  /** Tool call ID for approval tracking */
  toolCallId: string;
  /** Callback when user approves the update */
  onApprove: (toolCallId: string, alwaysAllow: boolean) => void;
  /** Callback when user denies the update */
  onDeny: (toolCallId: string) => void;
  /** Callback when dialog is closed */
  onClose: () => void;
}

/**
 * Get an icon for a memory file based on its name.
 */
function getMemoryFileIcon(filePath: string) {
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();
  const parts = normalizedPath.split("/");
  const fileName = parts[parts.length - 1] || "";

  switch (fileName) {
    case "soul.md":
      return <FiCpu className="w-5 h-5" />;
    case "user.md":
      return <FiUser className="w-5 h-5" />;
    case "memory.md":
    case "agents.md":
      return <FiDatabase className="w-5 h-5" />;
    default:
      return <FiFile className="w-5 h-5" />;
  }
}

/**
 * Get the file name from a path.
 */
function getFileName(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? filePath;
}

/**
 * Component to render a single diff line.
 */
function DiffLineDisplay({ line }: { line: DiffLine }) {
  const bgClass =
    line.type === "add"
      ? "bg-green-500/20 dark:bg-green-900/30"
      : line.type === "remove"
        ? "bg-red-500/20 dark:bg-red-900/30"
        : "";

  const textClass =
    line.type === "add"
      ? "text-green-700 dark:text-green-400"
      : line.type === "remove"
        ? "text-red-700 dark:text-red-400"
        : "text-text-default";

  const prefix = line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";

  return (
    <div className={cn("flex font-mono text-xs", bgClass)}>
      <span
        className={cn(
          "w-5 flex-shrink-0 text-right pr-1 select-none",
          line.type === "remove" ? "text-red-600 dark:text-red-500" : "text-text-subtle"
        )}
      >
        {line.oldLineNumber || ""}
      </span>
      <span
        className={cn(
          "w-5 flex-shrink-0 text-right pr-1 select-none",
          line.type === "add" ? "text-green-600 dark:text-green-500" : "text-text-subtle"
        )}
      >
        {line.newLineNumber || ""}
      </span>
      <span className={cn("w-4 flex-shrink-0 select-none font-bold", textClass)}>
        {prefix}
      </span>
      <span className={cn("flex-1 whitespace-pre", textClass)}>
        {line.content || " "}
      </span>
    </div>
  );
}

/**
 * MemoryUpdateDialog - Modal dialog for reviewing memory file updates.
 *
 * This dialog is shown when the agent wants to modify a memory file
 * (SOUL.md, USER.md, MEMORY.md, AGENTS.md, or files in memory/).
 * It displays a diff view of the proposed changes and allows the user
 * to approve or deny the update.
 */
export function MemoryUpdateDialog({
  isOpen,
  filePath,
  oldContent,
  newContent,
  toolCallId,
  onApprove,
  onDeny,
  onClose,
}: MemoryUpdateDialogProps) {
  const [alwaysAllow, setAlwaysAllow] = useState(false);

  // Generate diff
  const diff = useMemo(
    () => generateDiff(oldContent, newContent),
    [oldContent, newContent]
  );

  // Get diff stats
  const stats = useMemo(() => getDiffStats(diff), [diff]);

  const fileName = getFileName(filePath);
  const fileDescription = getMemoryFileDescription(filePath);
  const isNewFile = oldContent === "";

  const handleApprove = () => {
    onApprove(toolCallId, alwaysAllow);
    onClose();
  };

  const handleDeny = () => {
    onDeny(toolCallId);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400">
              {getMemoryFileIcon(filePath)}
            </div>
            <DialogTitle className="text-xl">Memory Update Request</DialogTitle>
          </div>
          <DialogDescription className="text-left">
            The agent wants to {isNewFile ? "create" : "update"} a memory file.
            Please review the changes below.
          </DialogDescription>
        </DialogHeader>

        {/* File info */}
        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label className="text-text-subtle text-xs uppercase tracking-wide">
                File
              </Label>
              <div className="flex items-center gap-2">
                <code className="px-2 py-1 text-sm font-mono bg-background-emphasis rounded">
                  {fileName}
                </code>
                <span className="text-sm text-text-subtle">{fileDescription}</span>
              </div>
            </div>
            <div className="text-right text-xs">
              <span className="text-green-600 dark:text-green-400">
                +{stats.additions}
              </span>
              {" / "}
              <span className="text-red-600 dark:text-red-400">
                -{stats.deletions}
              </span>
            </div>
          </div>
        </div>

        {/* Diff view */}
        <div className="flex-1 overflow-hidden">
          <Label className="text-text-subtle text-xs uppercase tracking-wide mb-2 block">
            {isNewFile ? "New Content" : "Changes"}
          </Label>
          <div className="border border-border rounded-lg overflow-auto max-h-[350px] bg-background">
            <div className="min-w-fit">
              {diff.length === 0 ? (
                <div className="p-4 text-sm text-text-subtle text-center">
                  No changes detected
                </div>
              ) : (
                diff.map((line, index) => (
                  <DiffLineDisplay key={index} line={line} />
                ))
              )}
            </div>
          </div>
        </div>

        {/* Always allow checkbox */}
        <div className="flex items-center space-x-2 pt-2">
          <Checkbox
            id="always-allow-memory"
            checked={alwaysAllow}
            onCheckedChange={(checked) => setAlwaysAllow(checked === true)}
          />
          <Label
            htmlFor="always-allow-memory"
            className="text-sm cursor-pointer text-text-subtle"
          >
            Always allow memory updates (for this session)
          </Label>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            danger
            secondary
            onClick={handleDeny}
            className="min-w-[100px]"
          >
            Deny
          </Button>
          <Button
            action
            onClick={handleApprove}
            className="min-w-[100px]"
          >
            Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default MemoryUpdateDialog;
