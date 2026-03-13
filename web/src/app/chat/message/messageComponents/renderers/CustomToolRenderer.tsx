import React, { useEffect, useMemo } from "react";
import { FiTool, FiAlertCircle } from "react-icons/fi";
import {
  PacketType,
  CustomToolPacket,
  CustomToolStart,
  CustomToolDelta,
  SectionEnd,
} from "../../../services/streamingModels";
import { MessageRenderer, RenderType } from "../interfaces";
import { BlinkingDot } from "../../BlinkingDot";
import { buildImgUrl } from "../../../components/files/images/utils";

const MAX_PREVIEW_LENGTH = 200;

/**
 * Build a human-readable preview string from the tool response data.
 */
function formatDataPreview(data: unknown, responseType: string | null): string {
  if (data === null || data === undefined) return "";

  if (responseType === "error") {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    return msg.length > MAX_PREVIEW_LENGTH
      ? msg.slice(0, MAX_PREVIEW_LENGTH) + "…"
      : msg;
  }

  if (typeof data === "string") {
    if (data.length === 0) return "";
    // Try to detect JSON strings and pretty-summarize them
    const trimmed = data.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return summarizeJson(parsed);
      } catch {
        // Not valid JSON — fall through to text preview
      }
    }
    return data.length > MAX_PREVIEW_LENGTH
      ? data.slice(0, MAX_PREVIEW_LENGTH) + "…"
      : data;
  }

  if (Array.isArray(data)) {
    return summarizeJson(data);
  }

  if (typeof data === "object") {
    return summarizeJson(data);
  }

  return String(data);
}

/**
 * Summarize a parsed JSON value into a brief description.
 */
function summarizeJson(value: unknown): string {
  if (Array.isArray(value)) {
    const count = value.length;
    if (count === 0) return "Empty list";
    // Show first item preview
    const firstPreview =
      typeof value[0] === "object" && value[0] !== null
        ? Object.keys(value[0]).slice(0, 4).join(", ")
        : String(value[0]).slice(0, 60);
    return count === 1
      ? `1 item: { ${firstPreview} }`
      : `${count} items — first: { ${firstPreview} }`;
  }

  if (typeof value === "object" && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "Empty object";
    const preview = keys.slice(0, 5).join(", ");
    const suffix = keys.length > 5 ? ` +${keys.length - 5} more` : "";
    return `{ ${preview}${suffix} }`;
  }

  const s = String(value);
  return s.length > MAX_PREVIEW_LENGTH
    ? s.slice(0, MAX_PREVIEW_LENGTH) + "…"
    : s;
}

function constructCustomToolState(packets: CustomToolPacket[]) {
  const toolStart = packets.find(
    (p) => p.obj.type === PacketType.CUSTOM_TOOL_START
  )?.obj as CustomToolStart | null;
  const toolDeltas = packets
    .filter((p) => p.obj.type === PacketType.CUSTOM_TOOL_DELTA)
    .map((p) => p.obj as CustomToolDelta);
  const toolEnd = packets.find((p) => p.obj.type === PacketType.SECTION_END)
    ?.obj as SectionEnd | null;

  const toolName = toolStart?.tool_name || toolDeltas[0]?.tool_name || "Tool";
  const latestDelta = toolDeltas[toolDeltas.length - 1] || null;
  const responseType = latestDelta?.response_type || null;
  const data = latestDelta?.data;
  const fileIds = latestDelta?.file_ids || null;
  const openui_response = latestDelta?.openui_response || null;

  const isRunning = Boolean(toolStart && !toolEnd);
  const isComplete = Boolean(toolStart && toolEnd);

  return {
    toolName,
    responseType,
    data,
    fileIds,
    openui_response,
    isRunning,
    isComplete,
  };
}

export const CustomToolRenderer: MessageRenderer<CustomToolPacket, {}> = ({
  packets,
  onComplete,
  renderType,
  children,
}) => {
  const {
    toolName,
    responseType,
    data,
    fileIds,
    openui_response,
    isRunning,
    isComplete,
  } = constructCustomToolState(packets);

  useEffect(() => {
    if (isComplete) {
      onComplete();
    }
  }, [isComplete, onComplete]);

  const status = useMemo(() => {
    if (isComplete) {
      if (responseType === "error") return `${toolName} failed`;
      if (openui_response) {
        const canvasTitle =
          (typeof data === "object" && data !== null && "title" in data)
            ? (data as Record<string, unknown>).title
            : null;
        return canvasTitle
          ? `Generated canvas: ${canvasTitle}`
          : `${toolName} generated a canvas`;
      }
      if (responseType === "image") return `${toolName} returned images`;
      if (responseType === "csv") return `${toolName} returned a file`;
      return `${toolName} completed`;
    }
    if (isRunning) return `${toolName} running...`;
    return null;
  }, [toolName, responseType, openui_response, data, isComplete, isRunning]);

  const dataPreview = useMemo(() => {
    if (!isComplete || data === undefined || data === null) return null;
    return formatDataPreview(data, responseType);
  }, [isComplete, data, responseType]);

  const icon = responseType === "error" ? FiAlertCircle : FiTool;

  // --- Canvas card path: openui_response is present ---
  // Canvas is rendered at the message level (outside steps accordion),
  // so here we only show a simple status line to avoid duplication.
  // `status` already contains the text; content is left empty to avoid double rendering.
  if (openui_response) {
    return children({
      icon,
      status,
      content: <></>,
    });
  }

  // --- Default path: no openui_response ---

  // HIGHLIGHT mode — compact, shown during streaming
  if (renderType === RenderType.HIGHLIGHT) {
    return children({
      icon,
      status,
      content: (
        <div className="text-sm text-text-600">
          {isRunning && <BlinkingDot />}
        </div>
      ),
    });
  }

  // FULL mode — expanded view with response preview
  const isError = responseType === "error";
  return children({
    icon,
    status,
    content: (
      <div className="mt-0.5">
        {isRunning && <BlinkingDot />}
        {isComplete && dataPreview && (
          <div
            className={`text-xs leading-relaxed line-clamp-3 ${
              isError ? "text-red-400" : "text-text-500"
            }`}
          >
            {dataPreview}
          </div>
        )}
      </div>
    ),
  });
};

export default CustomToolRenderer;
