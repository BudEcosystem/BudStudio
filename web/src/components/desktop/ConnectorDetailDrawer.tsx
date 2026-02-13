"use client";

import { useState, useEffect, useCallback } from "react";
import { X } from "lucide-react";
import type { ConnectorWithPreference, ConnectorTool } from "@/lib/agent/types";
import {
  fetchConnectorTools,
  getConnectorDisplay,
} from "@/lib/agent/connector-utils";
import {
  Drawer,
  DrawerContent,
  DrawerClose,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";

const PERMISSION_OPTIONS = [
  { value: "always_allow" as const, label: "Always Allow" },
  { value: "need_approval" as const, label: "Need Approval" },
  { value: "blocked" as const, label: "Blocked" },
];

function ToolPermissionRow({
  tool,
  onPermissionChange,
}: {
  tool: ConnectorTool;
  onPermissionChange: (toolName: string, permission: ConnectorTool["permission"]) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-background-tint-02">
      <div className="min-w-0 flex-1 mr-3">
        <span className="text-sm font-medium text-text-04 truncate block">
          {tool.name}
        </span>
        {tool.description && (
          <span className="text-xs text-text-02 truncate block mt-0.5">
            {tool.description}
          </span>
        )}
      </div>
      <select
        value={tool.permission}
        onChange={(e) =>
          onPermissionChange(
            tool.name,
            e.target.value as ConnectorTool["permission"]
          )
        }
        className="text-xs border border-border rounded px-2 py-1 bg-background text-text-04 shrink-0"
      >
        {PERMISSION_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ConnectorDetailDrawerProps {
  connector: ConnectorWithPreference | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onPermissionChange: (gatewayId: string, toolName: string, permission: ConnectorTool["permission"]) => void;
  onConnectorPermissionChange: (gatewayId: string, permission: ConnectorTool["permission"]) => void;
}

export function ConnectorDetailDrawer({
  connector,
  open,
  onOpenChange,
  onToggle,
  onConnect,
  onDisconnect,
  onPermissionChange,
  onConnectorPermissionChange,
}: ConnectorDetailDrawerProps) {
  const [tools, setTools] = useState<ConnectorTool[]>([]);
  const [loadingTools, setLoadingTools] = useState(false);

  const displayName = connector?.name
    ? getConnectorDisplay(connector.name)
    : connector
      ? { label: String(connector.id), initials: String(connector.id).slice(0, 2).toUpperCase(), color: "bg-gray-500" }
      : null;

  // Fetch tools when drawer opens with a connector
  useEffect(() => {
    if (!open || !connector) {
      return;
    }
    let cancelled = false;
    setLoadingTools(true);
    setTools([]);
    fetchConnectorTools(connector.id)
      .then((fetched) => {
        if (!cancelled) setTools(fetched);
      })
      .catch(() => {
        // Silently fail - tools section will show empty
      })
      .finally(() => {
        if (!cancelled) setLoadingTools(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, connector?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePermChange = useCallback(
    (toolName: string, permission: ConnectorTool["permission"]) => {
      if (!connector) return;
      setTools((prev) =>
        prev.map((t) => (t.name === toolName ? { ...t, permission } : t))
      );
      onPermissionChange(connector.id, toolName, permission);
    },
    [connector, onPermissionChange]
  );

  const handleConnectorPermChange = useCallback(
    (value: string) => {
      if (!connector) return;
      onConnectorPermissionChange(connector.id, value as ConnectorTool["permission"]);
    },
    [connector, onConnectorPermissionChange]
  );

  if (!connector || !displayName) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent direction="right" className="!top-14">
        {/* Header */}
        <div className="flex items-start gap-3 p-4 border-b border-border">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {connector.icon ? (
              <img
                src={connector.icon}
                alt={displayName.label}
                className="w-10 h-10 rounded-full shrink-0 object-cover bg-background-tint-02"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                  e.currentTarget.nextElementSibling?.classList.remove("hidden");
                }}
              />
            ) : null}
            <div
              className={`w-10 h-10 rounded-full ${displayName.color} flex items-center justify-center text-white text-sm font-bold shrink-0 ${connector.icon ? "hidden" : ""}`}
            >
              {displayName.initials}
            </div>
            <div className="flex-1 min-w-0">
              <DrawerTitle className="truncate">{displayName.label}</DrawerTitle>
              <DrawerDescription className="sr-only">
                Details for {displayName.label} connector
              </DrawerDescription>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => onToggle(connector.id, !connector.user_enabled)}
              className={`relative inline-flex h-4 w-7 cursor-pointer rounded-full transition-colors ${
                connector.user_enabled
                  ? "bg-purple-600"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
              title={connector.user_enabled ? "Disable" : "Enable"}
            >
              <span
                className={`pointer-events-none inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
                  connector.user_enabled
                    ? "translate-x-3.5"
                    : "translate-x-0.5"
                }`}
              />
            </button>
            <DrawerClose className="rounded-sm opacity-70 hover:opacity-100 transition-opacity">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DrawerClose>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {/* Info section */}
          <div className="p-4 space-y-3">
            {connector.description && (
              <p className="text-sm text-text-02">
                {String(connector.description)}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {connector.transport && (
                <span className="text-xs bg-background-tint-02 text-text-03 px-2 py-0.5 rounded-full">
                  {connector.transport === "STREAMABLEHTTP"
                    ? "HTTP"
                    : String(connector.transport)}
                </span>
              )}
              {connector.authType && (
                <span className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 px-2 py-0.5 rounded-full">
                  {String(connector.authType)}
                </span>
              )}
              {connector.oauth_completed && (
                <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                  Connected
                </span>
              )}
            </div>

            {/* Actions */}
            {(connector.oauth_completed || (connector.authType && !connector.oauth_completed)) && (
              <div className="flex gap-2 items-center pt-1">
                {connector.authType && !connector.oauth_completed && (
                  <button
                    onClick={() => onConnect(connector.id)}
                    className="text-sm font-medium px-4 py-1.5 rounded-md bg-purple-600 hover:bg-purple-700 text-white transition-colors"
                  >
                    Connect
                  </button>
                )}
                {connector.oauth_completed && (
                  <>
                    <span className="text-sm text-green-600 dark:text-green-400 font-medium py-1">
                      Connected
                    </span>
                    <button
                      onClick={() => onDisconnect(connector.id)}
                      className="text-sm font-medium px-4 py-1.5 rounded-md border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      Disconnect
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Default Permission */}
          <div className="border-t border-border px-4 py-3">
            <h3 className="text-xs font-semibold text-text-03 mb-2 uppercase tracking-wide">
              Default Permission
            </h3>
            <p className="text-xs text-text-02 mb-2">
              Applies to all tools unless overridden below.
            </p>
            <select
              value={connector.default_permission ?? "need_approval"}
              onChange={(e) => handleConnectorPermChange(e.target.value)}
              className="text-sm border border-border rounded px-3 py-1.5 bg-background text-text-04 w-full"
            >
              {PERMISSION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Per-tool overrides */}
          <div className="border-t border-border px-4 py-3">
            <h3 className="text-xs font-semibold text-text-03 mb-2 uppercase tracking-wide">
              Per-Tool Overrides (optional)
            </h3>
            {loadingTools ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 bg-background-tint-02 rounded-md animate-pulse" />
                ))}
              </div>
            ) : tools.length === 0 ? (
              <p className="text-sm text-text-02 py-2">No tools available.</p>
            ) : (
              <div className="space-y-0.5">
                {tools.map((tool) => (
                  <ToolPermissionRow
                    key={tool.name}
                    tool={tool}
                    onPermissionChange={handlePermChange}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
