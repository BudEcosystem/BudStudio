"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ConnectorWithPreference, ConnectorTool } from "@/lib/agent/types";
import {
  fetchConnectors,
  toggleConnector,
  initiateOAuth,
  disconnectOAuth,
  setToolPermission,
  setConnectorPermission,
  getConnectorDisplay,
} from "@/lib/agent/connector-utils";
import { AgentConnectorsSkeleton } from "./AgentConnectorsSkeleton";
import { ConnectorDetailDrawer } from "./ConnectorDetailDrawer";

function ConnectorCard({
  connector,
  onToggle,
  onSelect,
}: {
  connector: ConnectorWithPreference;
  onToggle: (id: string, enabled: boolean) => void;
  onSelect: (connector: ConnectorWithPreference) => void;
}) {
  const displayName = connector.name
    ? getConnectorDisplay(connector.name)
    : { label: String(connector.id), initials: String(connector.id).slice(0, 2).toUpperCase(), color: "bg-gray-500" };

  return (
    <div
      className="border border-border bg-background-tint-01 rounded-lg hover:shadow-sm transition-shadow flex flex-col cursor-pointer"
      onClick={() => onSelect(connector)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(connector);
        }
      }}
    >
      <div className="p-4 flex-1">
        <div className="flex items-start gap-3">
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
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-text-04 truncate">
                {displayName.label}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle(connector.id, !connector.user_enabled);
                }}
                className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full transition-colors ${
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
            </div>
            {connector.description && (
              <p className="text-sm text-text-02 line-clamp-2 mb-4">
                {String(connector.description)}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {connector.transport && (
                <span className="text-xs bg-background-neutral-03 px-2 py-0.5 rounded-md">
                  {connector.transport === "STREAMABLEHTTP"
                    ? "HTTP"
                    : String(connector.transport)}
                </span>
              )}
              {connector.authType && (
                <span className="text-xs bg-background-neutral-03 px-2 py-0.5 rounded-md">
                  {String(connector.authType)}
                </span>
              )}
              {connector.oauth_completed && (
                <span className="text-xs bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded-full">
                  Connected
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ConnectorsView() {
  const [connectors, setConnectors] = useState<ConnectorWithPreference[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const popupRef = useRef<Window | null>(null);
  const popupCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [selectedConnector, setSelectedConnector] = useState<ConnectorWithPreference | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const loadConnectors = useCallback(async () => {
    try {
      const data = await fetchConnectors();
      setConnectors(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load connectors");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConnectors();
  }, [loadConnectors]);

  // Listen for postMessage from the OAuth callback popup
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "OAUTH_COMPLETE") return;

      // Clean up popup check interval
      if (popupCheckRef.current) {
        clearInterval(popupCheckRef.current);
        popupCheckRef.current = null;
      }
      popupRef.current = null;

      // Refresh connectors regardless of success/error
      loadConnectors();
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      if (popupCheckRef.current) {
        clearInterval(popupCheckRef.current);
      }
    };
  }, [loadConnectors]);

  // Keep the selected connector in sync with the connectors list
  useEffect(() => {
    if (selectedConnector) {
      const updated = connectors.find((c) => c.id === selectedConnector.id);
      if (updated) {
        setSelectedConnector(updated);
      }
    }
  }, [connectors, selectedConnector?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToggle = useCallback(
    async (gatewayId: string, enabled: boolean) => {
      // Find the connector to pass its name
      const connector = connectors.find((c) => c.id === gatewayId);
      const gatewayName = connector?.name ?? "";

      // Optimistic update
      setConnectors((prev) =>
        prev.map((c) =>
          c.id === gatewayId ? { ...c, user_enabled: enabled } : c
        )
      );
      try {
        await toggleConnector(gatewayId, enabled, gatewayName);
      } catch {
        // Revert on failure
        setConnectors((prev) =>
          prev.map((c) =>
            c.id === gatewayId ? { ...c, user_enabled: !enabled } : c
          )
        );
      }
    },
    [connectors]
  );

  const handleConnect = useCallback(
    async (gatewayId: string) => {
      try {
        const { authorization_url } = await initiateOAuth(gatewayId);
        // Open OAuth popup
        const popup = window.open(
          authorization_url,
          "oauth_popup",
          "width=600,height=700,scrollbars=yes"
        );

        if (!popup) {
          setError("Popup was blocked by your browser. Please allow popups for this site and try again.");
          return;
        }

        popupRef.current = popup;

        // Fallback: detect popup closing without postMessage
        if (popupCheckRef.current) {
          clearInterval(popupCheckRef.current);
        }
        popupCheckRef.current = setInterval(() => {
          if (popup.closed) {
            if (popupCheckRef.current) {
              clearInterval(popupCheckRef.current);
              popupCheckRef.current = null;
            }
            popupRef.current = null;
            // Refresh in case OAuth completed but postMessage didn't fire
            loadConnectors();
          }
        }, 1000);
      } catch {
        // OAuth initiation failed - no action needed
      }
    },
    [loadConnectors]
  );

  const handleDisconnect = useCallback(
    async (gatewayId: string) => {
      // Optimistic update
      setConnectors((prev) =>
        prev.map((c) =>
          c.id === gatewayId ? { ...c, oauth_completed: false } : c
        )
      );
      try {
        await disconnectOAuth(gatewayId);
        // Refresh to get updated state from BudApp
        await loadConnectors();
      } catch {
        // Revert on failure
        setConnectors((prev) =>
          prev.map((c) =>
            c.id === gatewayId ? { ...c, oauth_completed: true } : c
          )
        );
      }
    },
    [loadConnectors]
  );

  const handlePermissionChange = useCallback(
    async (
      gatewayId: string,
      toolName: string,
      permission: ConnectorTool["permission"]
    ) => {
      try {
        await setToolPermission(gatewayId, toolName, permission);
      } catch {
        // Silently fail - UI already updated optimistically in the drawer
      }
    },
    []
  );

  const handleConnectorPermissionChange = useCallback(
    async (
      gatewayId: string,
      permission: "always_allow" | "need_approval" | "blocked"
    ) => {
      // Optimistic update
      setConnectors((prev) =>
        prev.map((c) =>
          c.id === gatewayId ? { ...c, default_permission: permission } : c
        )
      );
      try {
        await setConnectorPermission(gatewayId, permission);
      } catch {
        // Revert on failure
        loadConnectors();
      }
    },
    [loadConnectors]
  );

  const handleSelectConnector = useCallback(
    (connector: ConnectorWithPreference) => {
      setSelectedConnector(connector);
      setDrawerOpen(true);
    },
    []
  );

  if (isLoading) {
    return <AgentConnectorsSkeleton />;
  }

  if (error && connectors.length === 0) {
    return (
      <div className="flex-1 h-full overflow-y-auto">
        <div className="px-4 md:px-12 pt-24 pb-4">
          <h1 className="text-2xl font-bold text-text-04 mb-1">Connectors</h1>
          <p className="text-sm text-red-500">{error}</p>
        </div>
      </div>
    );
  }

  if (connectors.length === 0) {
    return (
      <div className="flex-1 h-full overflow-y-auto">
        <div className="px-4 md:px-12 pt-24 pb-4">
          <h1 className="text-2xl font-bold text-text-04 mb-1">Connectors</h1>
          <p className="text-sm text-text-02">No connectors available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 h-full overflow-y-auto" data-testid="connectors-view">
      <div className="px-4 md:px-12 pt-12 pb-4">
        <h1 className="text-2xl font-bold text-text-04 mb-1">Connectors</h1>
        <p className="text-sm text-text-02 mb-8">
          MCP gateway connectors available to the Bud Agent.
        </p>

        {error && (
          <div className="mb-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 flex items-center justify-between">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-400 hover:text-red-600 dark:hover:text-red-300 ml-3 shrink-0"
              aria-label="Dismiss"
            >
              &#10005;
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {connectors.map((connector) => (
            <ConnectorCard
              key={connector.id}
              connector={connector}
              onToggle={handleToggle}
              onSelect={handleSelectConnector}
            />
          ))}
        </div>
      </div>

      <ConnectorDetailDrawer
        connector={selectedConnector}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onToggle={handleToggle}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
        onPermissionChange={handlePermissionChange}
        onConnectorPermissionChange={handleConnectorPermissionChange}
      />
    </div>
  );
}
