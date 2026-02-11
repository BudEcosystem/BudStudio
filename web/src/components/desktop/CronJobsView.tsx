"use client";

import { useState, useEffect, useCallback } from "react";
import type { CronJob } from "@/lib/agent/types";

interface JobForm {
  name: string;
  schedule_type: "cron" | "interval" | "one_shot";
  cron_expression: string;
  interval_seconds: string;
  interval_preset: string;
  one_shot_at: string;
  payload_message: string;
  is_heartbeat: boolean;
}

const INTERVAL_PRESETS: { label: string; value: string }[] = [
  { label: "Every 5 minutes", value: "300" },
  { label: "Every 15 minutes", value: "900" },
  { label: "Every 30 minutes", value: "1800" },
  { label: "Every 1 hour", value: "3600" },
  { label: "Every 3 hours", value: "10800" },
  { label: "Every 6 hours", value: "21600" },
  { label: "Every 12 hours", value: "43200" },
  { label: "Every 24 hours", value: "86400" },
  { label: "Custom", value: "custom" },
];

const EMPTY_FORM: JobForm = {
  name: "",
  schedule_type: "interval",
  cron_expression: "",
  interval_seconds: "3600",
  interval_preset: "3600",
  one_shot_at: "",
  payload_message: "",
  is_heartbeat: false,
};

function formFromJob(job: CronJob): JobForm {
  const intervalStr = String(job.interval_seconds ?? 3600);
  const isPreset = INTERVAL_PRESETS.some(
    (p) => p.value === intervalStr && p.value !== "custom"
  );
  return {
    name: job.name,
    schedule_type: job.schedule_type,
    cron_expression: job.cron_expression ?? "",
    interval_seconds: intervalStr,
    interval_preset: isPreset ? intervalStr : "custom",
    one_shot_at: job.one_shot_at
      ? new Date(job.one_shot_at).toISOString().slice(0, 16)
      : "",
    payload_message: job.payload_message,
    is_heartbeat: job.is_heartbeat,
  };
}

function formatSchedule(job: CronJob): string {
  if (job.schedule_type === "cron") {
    return `cron: ${job.cron_expression}`;
  } else if (job.schedule_type === "interval") {
    const secs = job.interval_seconds ?? 0;
    if (secs >= 86400) return `Every ${Math.round(secs / 86400)}d`;
    if (secs >= 3600) return `Every ${Math.round(secs / 3600)}h`;
    if (secs >= 60) return `Every ${Math.round(secs / 60)}m`;
    return `Every ${secs}s`;
  }
  if (job.one_shot_at) {
    return new Date(job.one_shot_at).toLocaleString();
  }
  return "One-shot";
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Shared form fields used in both create and edit dialogs. */
function JobFormFields({
  form,
  setForm,
}: {
  form: JobForm;
  setForm: React.Dispatch<React.SetStateAction<JobForm>>;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Name</label>
        <input
          type="text"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          placeholder="My scheduled task"
          data-testid="cron-form-name"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Schedule Type</label>
        <select
          value={form.schedule_type}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              schedule_type: e.target.value as JobForm["schedule_type"],
            }))
          }
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
        >
          <option value="interval">Interval</option>
          <option value="cron">Cron Expression</option>
          <option value="one_shot">One Shot</option>
        </select>
      </div>

      {form.schedule_type === "cron" && (
        <div>
          <label className="block text-sm font-medium mb-1">
            Cron Expression
          </label>
          <input
            type="text"
            value={form.cron_expression}
            onChange={(e) =>
              setForm((f) => ({ ...f, cron_expression: e.target.value }))
            }
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            placeholder="0 */6 * * *"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Format: minute hour day month weekday (e.g. &quot;0 9 * * 1-5&quot;
            = 9am weekdays)
          </p>
        </div>
      )}

      {form.schedule_type === "interval" && (
        <div>
          <label className="block text-sm font-medium mb-1">
            Run Frequency
          </label>
          <select
            value={form.interval_preset}
            onChange={(e) => {
              const preset = e.target.value;
              setForm((f) => ({
                ...f,
                interval_preset: preset,
                interval_seconds:
                  preset === "custom" ? f.interval_seconds : preset,
              }));
            }}
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {form.interval_preset === "custom" && (
            <div className="mt-2">
              <label className="block text-xs text-muted-foreground mb-1">
                Custom interval (seconds)
              </label>
              <input
                type="number"
                value={form.interval_seconds}
                onChange={(e) =>
                  setForm((f) => ({ ...f, interval_seconds: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                min="60"
                placeholder="Minimum 60 seconds"
              />
            </div>
          )}
        </div>
      )}

      {form.schedule_type === "one_shot" && (
        <div>
          <label className="block text-sm font-medium mb-1">Run At</label>
          <input
            type="datetime-local"
            value={form.one_shot_at}
            onChange={(e) =>
              setForm((f) => ({ ...f, one_shot_at: e.target.value }))
            }
            className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
          />
        </div>
      )}

      <div>
        <label className="block text-sm font-medium mb-1">Prompt Message</label>
        <textarea
          value={form.payload_message}
          onChange={(e) =>
            setForm((f) => ({ ...f, payload_message: e.target.value }))
          }
          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm h-24 resize-none"
          placeholder="Check HEARTBEAT.md for pending tasks..."
          data-testid="cron-form-prompt"
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="is_heartbeat"
          checked={form.is_heartbeat}
          onChange={(e) =>
            setForm((f) => ({ ...f, is_heartbeat: e.target.checked }))
          }
          className="rounded border-border"
        />
        <label htmlFor="is_heartbeat" className="text-sm">
          Heartbeat job (reads HEARTBEAT.md)
        </label>
      </div>
    </div>
  );
}

/**
 * Cron jobs management view — full-width table with create/edit dialogs.
 */
export function CronJobsView() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/agent/cron/jobs");
      if (response.ok) {
        const data = await response.json();
        setJobs(data.jobs || []);
      }
    } catch {
      // Ignore
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const validateForm = (): Record<string, unknown> | null => {
    if (!form.name.trim()) {
      setFormError("Name is required");
      return null;
    }
    if (!form.payload_message.trim()) {
      setFormError("Prompt message is required");
      return null;
    }

    const body: Record<string, unknown> = {
      name: form.name.trim(),
      schedule_type: form.schedule_type,
      payload_message: form.payload_message.trim(),
      is_heartbeat: form.is_heartbeat,
    };

    if (form.schedule_type === "cron") {
      if (!form.cron_expression.trim()) {
        setFormError("Cron expression is required");
        return null;
      }
      body.cron_expression = form.cron_expression.trim();
    } else if (form.schedule_type === "interval") {
      const seconds = parseInt(form.interval_seconds, 10);
      if (isNaN(seconds) || seconds < 60) {
        setFormError("Interval must be at least 60 seconds");
        return null;
      }
      body.interval_seconds = seconds;
    } else if (form.schedule_type === "one_shot") {
      if (!form.one_shot_at) {
        setFormError("Date/time is required for one-shot schedule");
        return null;
      }
      body.one_shot_at = new Date(form.one_shot_at).toISOString();
    }

    return body;
  };

  const handleCreate = async () => {
    setFormError(null);
    const body = validateForm();
    if (!body) return;

    try {
      const response = await fetch("/api/agent/cron/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json();
        setFormError(err.detail || "Failed to create job");
        return;
      }
      setShowCreateDialog(false);
      setForm(EMPTY_FORM);
      fetchJobs();
    } catch {
      setFormError("Network error");
    }
  };

  const handleEdit = async () => {
    if (!editingJob) return;
    setFormError(null);
    const body = validateForm();
    if (!body) return;

    try {
      const response = await fetch(`/api/agent/cron/jobs/${editingJob.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const err = await response.json();
        setFormError(err.detail || "Failed to update job");
        return;
      }
      setEditingJob(null);
      setForm(EMPTY_FORM);
      fetchJobs();
    } catch {
      setFormError("Network error");
    }
  };

  const confirmDelete = async () => {
    if (!deletingJobId) return;
    try {
      const response = await fetch(`/api/agent/cron/jobs/${deletingJobId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== deletingJobId));
      }
    } catch {
      // Ignore
    } finally {
      setDeletingJobId(null);
    }
  };

  const handleRunNow = async (jobId: string) => {
    try {
      await fetch(`/api/agent/cron/jobs/${jobId}/run-now`, { method: "POST" });
    } catch {
      // Ignore
    }
  };

  const handleToggle = async (jobId: string, currentEnabled: boolean) => {
    try {
      const response = await fetch(`/api/agent/cron/jobs/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !currentEnabled }),
      });
      if (response.ok) {
        fetchJobs();
      }
    } catch {
      // Ignore
    }
  };

  const openEditDialog = (job: CronJob) => {
    setEditingJob(job);
    setForm(formFromJob(job));
    setFormError(null);
  };

  const closeDialog = () => {
    setShowCreateDialog(false);
    setEditingJob(null);
    setForm(EMPTY_FORM);
    setFormError(null);
  };

  const isDialogOpen = showCreateDialog || editingJob !== null;

  return (
    <div
      className="flex flex-col h-full bg-background"
      data-testid="cron-jobs-view"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-12 pt-24 pb-4">
        <div className="mb-0">
          <h1 className="text-2xl font-bold text-text-04">Scheduled Tasks</h1>
          <p className="text-sm text-text-02 mt-1">
            Manage automated agent tasks
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreateDialog(true);
            setForm(EMPTY_FORM);
            setFormError(null);
          }}
          className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700"
          data-testid="cron-new-job-button"
        >
          New Task
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto px-4 md:px-12 pb-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Loading...
          </p>
        ) : jobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">No scheduled tasks yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create a scheduled task to automate agent execution
            </p>
          </div>
        ) : (
          <div className="w-full border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Schedule
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Prompt
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Last Run
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Next Run
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                    Runs
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className="border-b border-border last:border-b-0 hover:bg-muted/30 transition-colors"
                    data-testid={`cron-job-row-${job.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={`w-2.5 h-2.5 rounded-full ${
                            job.enabled ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        <span className="text-xs text-muted-foreground">
                          {job.enabled ? "Active" : "Disabled"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{job.name}</span>
                        {job.is_heartbeat && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 border border-blue-500/20">
                            heartbeat
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatSchedule(job)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-[200px]">
                      <span className="block truncate">
                        {job.payload_message}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(job.last_run_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDateTime(job.next_run_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {job.run_count}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleRunNow(job.id)}
                          className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
                          title="Run now"
                        >
                          Run
                        </button>
                        <button
                          onClick={() => openEditDialog(job)}
                          className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
                          title="Edit"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggle(job.id, job.enabled)}
                          className="px-2.5 py-1 text-xs rounded border border-border hover:bg-muted transition-colors"
                        >
                          {job.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => setDeletingJobId(job.id)}
                          className="px-2.5 py-1 text-xs rounded border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10 transition-colors"
                          data-testid={`cron-job-delete-${job.id}`}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      {deletingJobId !== null && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm mx-4 p-6 rounded-xl bg-background border border-border shadow-2xl">
            <h2 className="text-lg font-semibold mb-2">Delete Scheduled Task</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Are you sure you want to delete this task? This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeletingJobId(null)}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Dialog */}
      {isDialogOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
          data-testid="cron-form-dialog"
        >
          <div className="w-full max-w-lg mx-4 p-6 rounded-xl bg-background border border-border shadow-2xl">
            <h2 className="text-lg font-semibold mb-4">
              {editingJob ? "Edit Scheduled Task" : "Create Scheduled Task"}
            </h2>

            <JobFormFields form={form} setForm={setForm} />

            {formError && (
              <p className="text-sm text-destructive mt-4">{formError}</p>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={closeDialog}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={editingJob ? handleEdit : handleCreate}
                disabled={!form.name || !form.payload_message}
                className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50"
                data-testid="cron-form-submit"
              >
                {editingJob ? "Save Changes" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
