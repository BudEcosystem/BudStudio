"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CronJob } from "@/lib/agent/types";

interface CustomSelectOption {
  label: string;
  value: string;
}

function CustomSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedLabel =
    options.find((o) => o.value === value)?.label ?? value;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-border bg-background text-sm cursor-pointer hover:border-muted-foreground transition-colors"
      >
        <span>{selectedLabel}</span>
        <svg
          className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background shadow-lg overflow-hidden">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors ${
                option.value === value
                  ? "bg-purple-600/10 text-purple-600 dark:text-purple-400 font-medium"
                  : "hover:bg-muted text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface JobForm {
  name: string;
  schedule_type: "cron" | "interval" | "one_shot";
  cron_expression: string;
  interval_seconds: string;
  interval_preset: string;
  one_shot_at: string;
  payload_message: string;
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
        <CustomSelect
          value={form.schedule_type}
          options={[
            { label: "Interval", value: "interval" },
            { label: "Cron Expression", value: "cron" },
            { label: "One Shot", value: "one_shot" },
          ]}
          onChange={(val) =>
            setForm((f) => ({
              ...f,
              schedule_type: val as JobForm["schedule_type"],
            }))
          }
        />
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
          <CustomSelect
            value={form.interval_preset}
            options={INTERVAL_PRESETS}
            onChange={(preset) => {
              setForm((f) => ({
                ...f,
                interval_preset: preset,
                interval_seconds:
                  preset === "custom" ? f.interval_seconds : preset,
              }));
            }}
          />
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
          placeholder="Check for any pending tasks..."
          data-testid="cron-form-prompt"
        />
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
      className="flex flex-col h-full"
      data-testid="cron-jobs-view"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 md:px-12 pt-12 pb-4">
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
          <div className="w-full border border-border rounded-lg overflow-hidden bg-background-tint-01">
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="bg-muted/50 border-b border-border">
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[10%]">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[20%]">
                    Name
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[15%]">
                    Schedule
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[15%]">
                    Last Run
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[15%]">
                    Next Run
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-muted-foreground w-[5%]">
                    Runs
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-muted-foreground w-[20%]">
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
                      <span className="font-medium truncate">{job.name}</span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate">
                      {formatSchedule(job)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate">
                      {formatDateTime(job.last_run_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground truncate">
                      {formatDateTime(job.next_run_at)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {job.run_count}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* Run now */}
                        <button
                          onClick={() => handleRunNow(job.id)}
                          className="p-2 cursor-pointer transition-colors text-muted-foreground hover:text-green-600 dark:hover:text-green-400"
                          title="Run now"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 3l14 9-14 9V3z" />
                          </svg>
                        </button>
                        {/* Edit */}
                        <button
                          onClick={() => openEditDialog(job)}
                          className="p-2 cursor-pointer transition-colors text-muted-foreground hover:text-blue-600 dark:hover:text-blue-400"
                          title="Edit"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        {/* Toggle enable/disable */}
                        <button
                          onClick={() => handleToggle(job.id, job.enabled)}
                          className="p-2 cursor-pointer transition-colors text-muted-foreground hover:text-yellow-600 dark:hover:text-yellow-400"
                          title={job.enabled ? "Disable" : "Enable"}
                        >
                          {job.enabled ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          )}
                        </button>
                        {/* Delete */}
                        <button
                          onClick={() => setDeletingJobId(job.id)}
                          className="p-2 cursor-pointer transition-colors text-muted-foreground hover:text-red-600 dark:hover:text-red-400"
                          title="Delete"
                          data-testid={`cron-job-delete-${job.id}`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
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
