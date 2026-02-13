import type { ConnectorWithPreference, ConnectorTool } from "./types";

/**
 * Extracts the connector type slug from a gateway name.
 * e.g. "prompt_xxx__v1__github" -> "github"
 */
export function extractConnectorType(gatewayName: string): string {
  const parts = gatewayName.split("__v1__");
  if (parts.length > 1) {
    return parts[parts.length - 1] ?? gatewayName;
  }
  return gatewayName;
}

interface ConnectorDisplayInfo {
  label: string;
  initials: string;
}

export const CONNECTOR_DISPLAY_MAP: Record<string, ConnectorDisplayInfo> = {
  github: { label: "GitHub", initials: "GH" },
  linear: { label: "Linear", initials: "LN" },
  "hugging-face": { label: "Hugging Face", initials: "HF" },
  deepwiki: { label: "DeepWiki", initials: "DW" },
  javadocs: { label: "JavaDocs", initials: "JD" },
  egnyte: { label: "Egnyte", initials: "EG" },
  "cloudflare-docs": { label: "Cloudflare Docs", initials: "CF" },
};

const CONNECTOR_COLORS = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-pink-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-red-500",
];

function getDeterministicColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % CONNECTOR_COLORS.length;
  return CONNECTOR_COLORS[index] as string;
}

export function getConnectorDisplay(gatewayName: string): {
  label: string;
  initials: string;
  color: string;
} {
  const type = extractConnectorType(gatewayName);
  const typeLower = type.toLowerCase();
  const info = CONNECTOR_DISPLAY_MAP[typeLower];
  if (info) {
    return { ...info, color: getDeterministicColor(typeLower) };
  }
  // Fallback: capitalize first two letters
  const initials = type.slice(0, 2).toUpperCase();
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return { label, initials, color: getDeterministicColor(typeLower) };
}

export function formatLastSeen(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ==============================================================================
// API helpers
// ==============================================================================

const BASE = "/api/agent/connectors";

export async function fetchConnectors(): Promise<ConnectorWithPreference[]> {
  const resp = await fetch(BASE);
  if (!resp.ok) {
    throw new Error(`Failed to fetch connectors: ${resp.status}`);
  }
  return resp.json();
}

export async function toggleConnector(
  gatewayId: string,
  enabled: boolean,
  gatewayName?: string
): Promise<void> {
  const body: Record<string, unknown> = { enabled };
  if (gatewayName) {
    body.gateway_name = gatewayName;
  }
  const resp = await fetch(`${BASE}/${gatewayId}/toggle`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Failed to toggle connector: ${resp.status}`);
  }
}

export async function initiateOAuth(
  gatewayId: string
): Promise<{ authorization_url: string }> {
  const resp = await fetch(`${BASE}/${gatewayId}/oauth/initiate`, {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Failed to initiate OAuth: ${resp.status}`);
  }
  return resp.json();
}

export async function markOAuthComplete(
  gatewayId: string
): Promise<{ completed: boolean }> {
  const resp = await fetch(`${BASE}/${gatewayId}/oauth/complete`, {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Failed to mark OAuth complete: ${resp.status}`);
  }
  return resp.json();
}

export async function disconnectOAuth(
  gatewayId: string
): Promise<void> {
  const resp = await fetch(`${BASE}/${gatewayId}/oauth/disconnect`, {
    method: "POST",
  });
  if (!resp.ok) {
    throw new Error(`Failed to disconnect OAuth: ${resp.status}`);
  }
}

export async function fetchConnectorTools(
  gatewayId: string
): Promise<ConnectorTool[]> {
  const resp = await fetch(`${BASE}/${gatewayId}/tools`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch connector tools: ${resp.status}`);
  }
  return resp.json();
}

export async function setConnectorPermission(
  gatewayId: string,
  permission: "always_allow" | "need_approval" | "blocked"
): Promise<void> {
  const resp = await fetch(`${BASE}/${gatewayId}/permission`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ permission }),
  });
  if (!resp.ok) {
    throw new Error(`Failed to set connector permission: ${resp.status}`);
  }
}

export async function setToolPermission(
  gatewayId: string,
  toolName: string,
  permission: "always_allow" | "need_approval" | "blocked"
): Promise<void> {
  const resp = await fetch(
    `${BASE}/${gatewayId}/tools/${encodeURIComponent(toolName)}/permission`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ permission }),
    }
  );
  if (!resp.ok) {
    throw new Error(`Failed to set tool permission: ${resp.status}`);
  }
}
