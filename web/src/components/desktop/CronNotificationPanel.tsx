"use client";

import { useCronNotifications } from "./CronNotificationContext";
import type { CronNotification, CronToolRequest } from "@/lib/agent/types";
import { useTheme } from "next-themes";

function formatSkipReason(reason: string | null): string {
  if (!reason) return "Skipped";
  const map: Record<string, string> = {
    "empty-heartbeat-file": "HEARTBEAT.md is empty",
    "heartbeat-unchanged": "No changes since last run",
    "already-in-progress": "Already running",
    "one-shot-completed": "One-shot already completed",
    "heartbeat-ok": "Nothing needs attention",
    "duplicate-response": "Same as previous response",
    "session-busy": "User session is active",
  };
  return map[reason] || reason;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Status-colored icon inside a rounded square. */
function StatusIcon({ status, isDark }: { status: string; isDark: boolean }) {
  const colors: Record<string, string> = {
    completed: "text-green-400",
    failed: "text-red-400",
    skipped: "text-yellow-400",
    suspended: "text-blue-400",
  };
  const color = colors[status] || "text-[#A4A4A9]";

  const paths: Record<string, string> = {
    completed: "M5 13l4 4L19 7",
    failed: "M6 18L18 6M6 6l12 12",
    skipped: "M12 9v2m0 4h.01M12 3a9 9 0 110 18 9 9 0 010-18z",
    suspended: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  };
  const d = paths[status] || paths.suspended;

  return (
    <div
      className={`${isDark ? "bg-[#1F1F1F]" : "bg-gray-100"} rounded-[0.4rem] flex items-center justify-center flex-shrink-0`}
      style={{ width: "2.75rem", height: "2.75rem" }}
    >
      <svg
        className={`w-[1.5rem] h-[1.5rem] ${color}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d={d} />
      </svg>
    </div>
  );
}

/** Status badge matching Bud admin's tag style. */
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-500/15 text-green-400 border-green-500/30",
    failed: "bg-red-500/15 text-red-400 border-red-500/30",
    skipped: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
    suspended: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  };
  const style = styles[status] || "bg-[#1F1F1F] text-[#A4A4A9] border-[#1F1F1F]";
  const label =
    status === "suspended"
      ? "Awaiting Input"
      : status.charAt(0).toUpperCase() + status.slice(1);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border ${style}`}
    >
      {label}
    </span>
  );
}

function NotificationCard({
  notification,
  onDismiss,
  isDark,
}: {
  notification: CronNotification;
  onDismiss: (id: string) => void;
  isDark: boolean;
}) {
  const timeStr = notification.completed_at
    ? formatTime(notification.completed_at)
    : formatTime(notification.created_at);

  return (
    <div className={`fileInput flex justify-between items-start px-[1.3rem] py-[1.25rem] ${isDark ? "bg-[#161616] border-[#1F1F1F]" : "bg-white border-gray-200"} border rounded-[1rem] transition-all duration-300 cursor-pointer group`}>
      <div className="flex justify-start items-center max-w-[65%]">
        <StatusIcon status={notification.status} isDark={isDark} />
        <div className="pt-[0.3rem] max-w-[94%] ml-[0.75rem]">
          <p className={`text-[0.75rem] font-normal ${isDark ? "text-[#A4A4A9]" : "text-gray-500"} tracking-[-0.01rem] truncate`}>
            {notification.cron_job_name}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`${isDark ? "text-[#EEEEEE]" : "text-gray-900"} text-[0.875rem] font-semibold leading-[1.5rem] tracking-[-0.01rem] truncate`}>
              {notification.status === "completed" && notification.result_summary
                ? notification.result_summary.slice(0, 60) +
                  (notification.result_summary.length > 60 ? "..." : "")
                : notification.status === "failed" && notification.error_message
                  ? notification.error_message.slice(0, 60) +
                    (notification.error_message.length > 60 ? "..." : "")
                  : notification.status === "skipped" && notification.skip_reason
                    ? formatSkipReason(notification.skip_reason)
                    : notification.status.charAt(0).toUpperCase() +
                      notification.status.slice(1)}
            </span>
            <StatusBadge status={notification.status} />
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end justify-between h-[2.75rem]">
        <p className={`text-[0.625rem] font-normal ${isDark ? "text-[#A4A4A9]" : "text-gray-500"}`}>{timeStr}</p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss(notification.id);
          }}
          className={`opacity-0 group-hover:opacity-100 transition-opacity ${isDark ? "text-[#757575] hover:text-[#EEEEEE]" : "text-gray-400 hover:text-gray-700"}`}
          title="Dismiss"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function ToolRequestCard({
  toolRequest,
  onApprove,
  onDeny,
  isDark,
}: {
  toolRequest: CronToolRequest;
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
  isDark: boolean;
}) {
  const timeStr = formatTime(toolRequest.created_at);

  return (
    <div className={`fileInput flex flex-col px-[1.3rem] py-[1.25rem] ${isDark ? "bg-[#161616] border-[#1F1F1F]" : "bg-white border-gray-200"} border rounded-[1rem] transition-all duration-300`}>
      <div className="flex justify-between items-start">
        <div className="flex justify-start items-center max-w-[65%]">
          <div
            className={`${isDark ? "bg-[#1F1F1F]" : "bg-gray-100"} rounded-[0.4rem] flex items-center justify-center flex-shrink-0`}
            style={{ width: "2.75rem", height: "2.75rem" }}
          >
            <span className="text-yellow-400 text-lg font-bold">!</span>
          </div>
          <div className="pt-[0.3rem] max-w-[94%] ml-[0.75rem]">
            <p className={`text-[0.75rem] font-normal ${isDark ? "text-[#A4A4A9]" : "text-gray-500"} tracking-[-0.01rem] truncate`}>
              {toolRequest.cron_job_name}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`${isDark ? "text-[#EEEEEE]" : "text-gray-900"} text-[0.875rem] font-semibold leading-[1.5rem] tracking-[-0.01rem] truncate`}>
                Approval Required
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold border bg-yellow-500/15 text-yellow-400 border-yellow-500/30">
                Pending
              </span>
            </div>
          </div>
        </div>
        <p className={`text-[0.625rem] font-normal ${isDark ? "text-[#A4A4A9]" : "text-gray-500"} flex-shrink-0`}>
          {timeStr}
        </p>
      </div>

      {/* Tool info */}
      <div className="mt-3 ml-[3.5rem] space-y-1.5">
        <p className={`text-[0.75rem] ${isDark ? "text-[#A4A4A9]" : "text-gray-500"}`}>
          Tool:{" "}
          <code className={`px-1.5 py-0.5 rounded ${isDark ? "bg-[#1F1F1F] text-[#EEEEEE]" : "bg-gray-100 text-gray-900"} text-[11px]`}>
            {toolRequest.tool_name}
          </code>
        </p>
        {toolRequest.tool_input && (
          <pre className={`p-2 rounded-lg ${isDark ? "bg-[#1F1F1F] text-[#A4A4A9] border-[#2A2A2A]" : "bg-gray-50 text-gray-600 border-gray-200"} text-[11px] overflow-x-auto max-h-24 border`}>
            {JSON.stringify(toolRequest.tool_input, null, 2)}
          </pre>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 mt-3 ml-[3.5rem]">
        <button
          onClick={() => onApprove(toolRequest.id)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(toolRequest.id)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600/80 hover:bg-red-600 text-white transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}

/**
 * Full-screen notification overlay panel — Bud admin style.
 * Dark overlay with transparent content area, dark notification cards.
 */
export function CronNotificationPanel({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const {
    notifications,
    toolRequests,
    dismissNotification,
    submitToolResult,
  } = useCronNotifications();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  if (!isOpen) return null;

  const dismissAll = async () => {
    for (const n of notifications) {
      await dismissNotification(n.id);
    }
  };

  const handleApprove = (executionId: string) => {
    submitToolResult(executionId, "approved", undefined);
  };

  const handleDeny = (executionId: string) => {
    submitToolResult(executionId, undefined, "User denied tool execution");
  };

  const totalCount = notifications.length + toolRequests.length;

  return (
    <div
      className="fixed inset-0 z-[9999] overflow-hidden transition-all duration-500 ease-in-out"
      style={isDark ? {
        backgroundImage: "url(/images/notification-bg.png)",
        backgroundPosition: "50%",
        backgroundRepeat: "no-repeat",
        backgroundColor: "#060607",
        backgroundSize: "98.2% 96.5%",
      } : {
        backgroundColor: "#f5f5f5",
      }}
      data-testid="cron-notification-panel"
    >
      {/* Click-away backdrop (transparent, over any uncovered area) */}
      <div
        className="absolute inset-0"
        onClick={onClose}
      />

      {/* Close button — circular with backdrop blur, top-right */}
      <button
        onClick={onClose}
        className={`absolute right-[2.05rem] top-[2.05rem] w-[2rem] h-[2rem] rounded-full flex justify-center items-center backdrop-blur-[34px] ${isDark ? "bg-white/5 border-[#757575] hover:bg-white/10" : "bg-black/5 border-gray-300 hover:bg-black/10"} border z-10 cursor-pointer transition-colors`}
      >
        <svg
          className={`w-3.5 h-3.5 ${isDark ? "text-[#EEEEEE]" : "text-gray-700"}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>

      {/* Content area */}
      <div className="relative flex justify-center items-start w-full h-full pt-[4.6rem] pb-[0.7rem] px-[2.25rem]">
        {/* Notification list — left side, scrollable */}
        <div className="w-full h-full">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-[1rem] gap-y-[1rem]">
            {/* Notification list panel */}
            <div
              className={`rounded-[16px] py-[1.25rem] border ${isDark ? "border-[#1F1F1F] bg-[#0A0A0B]" : "border-gray-200 bg-white"} max-h-[90vh] overflow-y-auto`}
              style={{ gridRow: "1 / span 100" }}
            >
              {/* Header */}
              <div className="flex justify-between items-center px-[1.5rem]">
                <h2 className={`${isDark ? "text-[#EEEEEE]" : "text-gray-900"} font-semibold text-[1.5rem] leading-[100%] tracking-[-0.015rem]`}>
                  Notifications
                </h2>
                <div className="flex justify-end items-center gap-3">
                  {notifications.length > 0 && (
                    <button
                      onClick={dismissAll}
                      className={`text-[0.75rem] ${isDark ? "text-[#A4A4A9] hover:text-[#EEEEEE]" : "text-gray-500 hover:text-gray-900"} transition-colors cursor-pointer`}
                    >
                      Clear all
                    </button>
                  )}
                </div>
              </div>

              {/* Card list */}
              <div className="notificationList mt-[1.3rem] flex flex-col gap-[0.7rem] px-[1.5rem]">
                {totalCount === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className={`w-12 h-12 rounded-full ${isDark ? "bg-[#1F1F1F]" : "bg-gray-100"} flex items-center justify-center mb-3`}>
                      <svg
                        className={`w-6 h-6 ${isDark ? "text-[#757575]" : "text-gray-400"}`}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
                        />
                      </svg>
                    </div>
                    <p className={`text-sm ${isDark ? "text-[#A4A4A9]" : "text-gray-500"}`}>No recent activity</p>
                    <p className={`text-xs ${isDark ? "text-[#757575]" : "text-gray-400"} mt-1`}>
                      Scheduled task results will appear here
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Tool requests first */}
                    {toolRequests.map((tr) => (
                      <ToolRequestCard
                        key={`tool-${tr.id}`}
                        toolRequest={tr}
                        onApprove={handleApprove}
                        onDeny={handleDeny}
                        isDark={isDark}
                      />
                    ))}
                    {/* Notifications */}
                    {notifications.map((notification) => (
                      <NotificationCard
                        key={notification.id}
                        notification={notification}
                        onDismiss={dismissNotification}
                        isDark={isDark}
                      />
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
