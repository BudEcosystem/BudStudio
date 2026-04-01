"use client";

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import type { SpawnSubSessionResponse } from "@/lib/desktop/subSessionTypes";

export interface SubSessionSpinOffDialogProps {
  isOpen: boolean;
  onClose: () => void;
  sourceContent: string;
  parentSessionId: string;
  onSpawned?: (sessionId: string) => void;
}

type SpinOffMode = "one_shot" | "persistent";

/**
 * Modal dialog for spinning off a new sub-session from the current conversation.
 * Allows editing the task, selecting the mode, and spawning.
 */
export function SubSessionSpinOffDialog({
  isOpen,
  onClose,
  sourceContent,
  parentSessionId,
  onSpawned,
}: SubSessionSpinOffDialogProps) {
  const [task, setTask] = useState(sourceContent);
  const [mode, setMode] = useState<SpinOffMode>("one_shot");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync task when sourceContent changes (dialog re-opens with new content)
  // We use a simple check: when dialog opens, reset task to sourceContent
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setTask(sourceContent);
        setMode("one_shot");
        setError(null);
      } else {
        onClose();
      }
    },
    [sourceContent, onClose]
  );

  const handleStart = useCallback(async () => {
    const trimmed = task.trim();
    if (!trimmed) {
      setError("Task cannot be empty.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/agent/sessions/${parentSessionId}/spin-off`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ task: trimmed, mode }),
        }
      );

      if (!res.ok) {
        const body = await res.text();
        setError(body || `Failed to spawn sub-session (${res.status})`);
        return;
      }

      const data = (await res.json()) as SpawnSubSessionResponse;
      onSpawned?.(data.session_id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  }, [task, mode, parentSessionId, onSpawned, onClose]);

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Spin Off Sub-Session</DialogTitle>
          <DialogDescription>
            Create a new sub-session to work on this task independently.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Task input */}
          <div className="space-y-2">
            <Label htmlFor="spin-off-task">Task</Label>
            <Textarea
              id="spin-off-task"
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe the task for the sub-session..."
              rows={3}
              disabled={isSubmitting}
            />
          </div>

          {/* Mode selector */}
          <div className="space-y-2">
            <Label>Mode</Label>
            <RadioGroup
              value={mode}
              onValueChange={(val) => setMode(val as SpinOffMode)}
              className="flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="one_shot" id="mode-one-shot" />
                <Label htmlFor="mode-one-shot" className="font-normal cursor-pointer">
                  One-Shot
                  <span className="text-xs text-text-02 ml-1">
                    - Completes the task and returns the result
                  </span>
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="persistent" id="mode-persistent" />
                <Label htmlFor="mode-persistent" className="font-normal cursor-pointer">
                  Persistent
                  <span className="text-xs text-text-02 ml-1">
                    - Stays open for follow-up messages
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Error display */}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 px-3 py-2">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className={cn(
              "px-4 py-2 text-sm rounded-md",
              "border border-border text-text-04 hover:bg-background-tint-02",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleStart}
            disabled={isSubmitting || !task.trim()}
            className={cn(
              "px-4 py-2 text-sm rounded-md font-medium",
              "bg-blue-600 text-white hover:bg-blue-700",
              "dark:bg-blue-500 dark:hover:bg-blue-600",
              "disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
              "flex items-center gap-1.5"
            )}
          >
            {isSubmitting && (
              <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Start
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
