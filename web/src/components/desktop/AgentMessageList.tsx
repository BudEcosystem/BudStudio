"use client";

import React, { useState, useMemo, useRef } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";
import { FiTool, FiCheck, FiX, FiAlertCircle, FiMessageSquare } from "react-icons/fi";
import { useMarkdownRenderer } from "@/app/chat/message/messageComponents/markdownUtils";
import { copyAll } from "@/app/chat/message/copyingUtils";
import MultiToolRenderer from "@/app/chat/message/messageComponents/MultiToolRenderer";
import { BlinkingDot } from "@/app/chat/message/BlinkingDot";
import {
  buildInterleavedSegments,
  getTextContent,
  groupPacketsByInd,
  isToolPacket,
} from "@/app/chat/services/packetUtils";
import { PacketType } from "@/app/chat/services/streamingModels";
import Text from "@/refresh-components/texts/Text";
import IconButton from "@/refresh-components/buttons/IconButton";
import SvgCopy from "@/icons/copy";
import SvgCheck from "@/icons/check";
import AgentIcon from "@/refresh-components/AgentIcon";
import type { AgentMessage, ToolCallInfo } from "./AgentSessionContext";
import type { Packet } from "@/app/chat/services/streamingModels";
import type { FullChatState } from "@/app/chat/message/messageComponents/interfaces";
import type { OnyxDocument } from "@/lib/search/interfaces";
import type { MinimalPersonaSnapshot } from "@/app/admin/assistants/interfaces";
import type {
  SearchToolDelta,
  FetchToolStart,
  CitationDelta,
  StreamingCitation,
} from "@/app/chat/services/streamingModels";

/** Format a date as relative time (e.g. "2m ago", "1h ago", "3d ago"). */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Extract citation data and document map from an array of packets.
 * Returns { docs, citations, documentMap } for rendering popovers and sources.
 */
function extractCitationData(packets: Packet[]): {
  docs: OnyxDocument[];
  citations: StreamingCitation[];
  documentMap: Map<string, OnyxDocument>;
} {
  const documentMap = new Map<string, OnyxDocument>();
  const citations: StreamingCitation[] = [];
  const seenCitationDocIds = new Set<string>();

  for (const packet of packets) {
    if (!packet.obj) continue;
    if (
      packet.obj.type === PacketType.SEARCH_TOOL_DELTA ||
      packet.obj.type === PacketType.FETCH_TOOL_START
    ) {
      const toolObj = packet.obj as SearchToolDelta | FetchToolStart;
      if ("documents" in toolObj && toolObj.documents) {
        for (const doc of toolObj.documents) {
          if (doc.document_id) {
            documentMap.set(doc.document_id, doc);
          }
        }
      }
    }

    if (packet.obj.type === PacketType.CITATION_DELTA) {
      const citationObj = packet.obj as CitationDelta;
      if (citationObj.citations) {
        for (const citation of citationObj.citations) {
          if (!seenCitationDocIds.has(citation.document_id)) {
            seenCitationDocIds.add(citation.document_id);
            citations.push(citation);
          }
        }
      }
    }
  }

  const docs: OnyxDocument[] = [];
  if (citations.length > 0) {
    const maxCitNum = Math.max(...citations.map((c) => c.citation_num));
    for (let i = 0; i < maxCitNum; i++) {
      const citation = citations.find((c) => c.citation_num === i + 1);
      if (citation) {
        const doc = documentMap.get(citation.document_id);
        if (doc) {
          docs[i] = doc;
        }
      }
    }
  }

  return { docs, citations, documentMap };
}

/**
 * Renders agent message content with full markdown support (code blocks, GFM tables, math, etc.)
 * When docs are provided, citation popovers are enabled (e.g., [1] shows tooltip on hover).
 */
function AgentMessageContent({
  content,
  docs,
  assistant,
}: {
  content: string;
  docs?: OnyxDocument[] | null;
  assistant?: MinimalPersonaSnapshot | null;
}) {
  const state = useMemo<FullChatState | undefined>(() => {
    if (!docs || docs.length === 0 || !assistant) return undefined;
    return {
      handleFeedback: () => {},
      assistant: assistant,
      docs,
      setPresentingDocument: () => {},
    };
  }, [docs, assistant]);

  const { renderedContent } = useMarkdownRenderer(content, state, "text-base");
  return (
    <div className="overflow-x-visible max-w-content-max break-words">
      {renderedContent}
    </div>
  );
}

/**
 * Display component for a single tool call (legacy fallback).
 */
function ToolCallDisplay({ toolCall }: { toolCall: ToolCallInfo }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusIcon = () => {
    switch (toolCall.status) {
      case "running":
        return (
          <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
        );
      case "complete":
        return <FiCheck className="w-4 h-4 text-green-500" />;
      case "error":
        return <FiX className="w-4 h-4 text-red-500" />;
      case "approval_required":
        return <FiAlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <FiTool className="w-4 h-4 text-text-subtle" />;
    }
  };

  const getStatusText = () => {
    switch (toolCall.status) {
      case "running":
        return "Running...";
      case "complete":
        return "Complete";
      case "error":
        return "Error";
      case "approval_required":
        return "Approval Required";
      default:
        return "";
    }
  };

  return (
    <div className="border border-border rounded-lg overflow-hidden" data-testid={`tool-call-${toolCall.name}`}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        data-testid={`tool-call-header-${toolCall.name}`}
        className="w-full flex items-center gap-2 px-3 py-2 bg-background hover:bg-background-emphasis transition-colors text-left"
      >
        {getStatusIcon()}
        <span className="flex-1 text-xs font-medium truncate" data-testid="tool-call-name">
          {toolCall.name}
        </span>
        <span className="text-xs text-text-subtle" data-testid={`tool-call-status-${toolCall.status}`}>{getStatusText()}</span>
      </button>

      {isExpanded && (
        <div className="border-t border-border p-3 space-y-2 text-xs">
          <div>
            <div className="font-medium text-text-subtle mb-1">Input:</div>
            <pre className="bg-background p-2 rounded overflow-auto max-h-32">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>

          {toolCall.output && (
            <div>
              <div className="font-medium text-text-subtle mb-1">Output:</div>
              <pre className="bg-background p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                {toolCall.output}
              </pre>
            </div>
          )}

          {toolCall.error && (
            <div>
              <div className="font-medium text-red-500 mb-1">Error:</div>
              <pre className="bg-red-500/10 text-red-500 p-2 rounded overflow-auto max-h-32 whitespace-pre-wrap">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface AgentMessageListProps {
  messages: AgentMessage[];
  /** Assistant to use for markdown citation rendering. */
  selectedAssistant?: MinimalPersonaSnapshot | null;
  /** Dark mode override. If not provided, auto-detects via useTheme. */
  isDark?: boolean;
  /** Compact mode for thread panel (no agent icon, smaller padding). */
  compact?: boolean;
  /**
   * Optional callback to render extra content at the end of each agent message
   * (e.g., artifact cards, citation source toggles). Called only for agent messages.
   */
  renderMessageExtra?: (msg: AgentMessage) => React.ReactNode;
  /**
   * Optional callback to render inline elements next to the copy button
   * (e.g., sub-session chips). Called only for completed agent messages.
   */
  renderInlineActions?: (msg: AgentMessage) => React.ReactNode;
  /**
   * Callback when user clicks the thread button on a message.
   * If provided, a thread icon appears next to the copy button.
   * The threadMap provides existing thread reply counts keyed by message ID.
   */
  onThreadClick?: (msg: AgentMessage) => void;
  /** Map of message ID -> thread info for existing threads. */
  threadMap?: Map<string, { count: number; label?: string; lastReplyAt?: string }>;
}

/**
 * Shared message list renderer used by both BudAgentScreen and SubSessionThreadPanel.
 *
 * Handles:
 * 1. User messages (right-aligned bubble)
 * 2. Agent messages with:
 *    - BlinkingDot for thinking state
 *    - Status indicator (error/stopped)
 *    - Interleaved tool+content rendering (MultiToolRenderer + AgentMessageContent)
 *    - Fallback legacy tool calls (ToolCallDisplay)
 *    - Plain markdown content (AgentMessageContent)
 *    - Copy button
 */
export function AgentMessageList({
  messages,
  selectedAssistant,
  isDark: isDarkProp,
  compact = false,
  renderMessageExtra,
  renderInlineActions,
  onThreadClick,
  threadMap,
}: AgentMessageListProps) {
  const { resolvedTheme } = useTheme();
  const isDark = isDarkProp ?? resolvedTheme === "dark";

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Minimal FullChatState for MultiToolRenderer.
  // Always create a valid state so tool rendering works even without a
  // selectedAssistant (e.g. in the thread panel / compact mode).
  const minimalChatState = useMemo<FullChatState>(() => {
    return {
      handleFeedback: () => {},
      assistant: selectedAssistant ?? { id: 0, name: "Agent", description: "" },
    };
  }, [selectedAssistant]);

  return (
    <>
      {messages.map((msg: AgentMessage) =>
        msg.role === "user" ? (
          <div
            key={msg.id}
            className={cn("w-full flex", compact ? "pt-3 pb-1" : "pt-5 pb-1")}
            data-testid="agent-message-user"
          >
            <div
              className="ml-auto max-w-[25rem] whitespace-break-spaces rounded-t-16 rounded-bl-16 py-2 px-3"
              style={{
                backgroundColor: isDark ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.06)",
              }}
            >
              <Text mainContentBody>{msg.content}</Text>
            </div>
          </div>
        ) : (
          <div
            key={msg.id}
            className={cn("relative flex", compact ? "py-3" : "py-5")}
            data-testid="agent-message-agent"
          >
            <div className={cn("w-full", compact ? "" : "max-w-message-max mx-auto")}>
              <div className="flex items-start">
                {!compact && selectedAssistant && (
                  <AgentIcon agent={selectedAssistant} />
                )}
                <div className={cn("w-full", !compact && "ml-4")}>
                  <div className="max-w-content-max break-words">
                    {/* Initial loading dot before any packets arrive */}
                    {msg.status === "thinking" &&
                      !msg.content &&
                      (!msg.packets || msg.packets.length === 0) && (
                        <div className="py-1">
                          <BlinkingDot />
                        </div>
                      )}

                    {/* Status indicator - only for error/stopped states */}
                    {msg.status &&
                      msg.status !== "complete" &&
                      msg.status !== "thinking" &&
                      msg.status !== "streaming" && (
                        <span
                          data-testid="agent-message-status"
                          className={cn(
                            "text-xs mb-1 block",
                            msg.status === "error"
                              ? "text-red-500"
                              : msg.status === "stopped"
                                ? "text-yellow-500"
                                : "text-text-subtle"
                          )}
                        >
                          {msg.status === "error" && "error"}
                          {msg.status === "stopped" && "stopped"}
                        </span>
                      )}

                    {/* Interleaved tool calls + content rendering */}
                    {msg.packets &&
                    msg.packets.length > 0 &&
                    msg.packets.some((p) => p.obj && isToolPacket(p, false))
                      ? (() => {
                          const grouped = groupPacketsByInd(msg.packets!);
                          const segments = buildInterleavedSegments(grouped);
                          const isMessageDone =
                            msg.status === "complete" ||
                            msg.status === "error" ||
                            msg.status === "stopped";
                          const hasStop = msg.packets!.some(
                            (p) => p.obj?.type === "stop"
                          );
                          const citationData = extractCitationData(msg.packets!);
                          const lastToolSegIdx = segments.reduce(
                            (acc, seg, idx) =>
                              seg.type === "tools" ? idx : acc,
                            -1
                          );
                          const lastDisplaySegIdx = segments.reduce(
                            (acc, seg, idx) =>
                              seg.type === "display" ? idx : acc,
                            -1
                          );

                          return (
                            <>
                              {segments.map((segment, segIdx) => {
                                if (segment.type === "tools") {
                                  const isLastToolSeg =
                                    segIdx === lastToolSegIdx;
                                  const hasFollowingDisplay =
                                    lastDisplaySegIdx > segIdx;
                                  const segComplete =
                                    !isLastToolSeg ||
                                    isMessageDone ||
                                    hasFollowingDisplay;
                                  return (
                                    <div
                                      key={`tools-${segment.groups[0]?.ind ?? segIdx}`}
                                      className="mb-3"
                                      data-testid="agent-tool-calls"
                                    >
                                      <MultiToolRenderer
                                        packetGroups={segment.groups}
                                        chatState={minimalChatState}
                                        isComplete={segComplete}
                                        isFinalAnswerComing={segComplete}
                                        stopPacketSeen={hasStop}
                                      />
                                    </div>
                                  );
                                }

                                // Display segment -- extract text from packets
                                const segmentText = getTextContent(
                                  segment.group.packets
                                );
                                if (!segmentText) return null;
                                const isLastDisplay =
                                  segIdx === lastDisplaySegIdx;

                                return (
                                  <div key={`display-${segment.group.ind}`}>
                                    <AgentMessageContent
                                      content={segmentText}
                                      docs={citationData.docs}
                                      assistant={selectedAssistant}
                                    />
                                    {isLastDisplay && isMessageDone && (
                                      <div className="flex items-center gap-x-0.5 mt-1">
                                        <IconButton
                                          icon={
                                            copiedMessageId === msg.id
                                              ? SvgCheck
                                              : SvgCopy
                                          }
                                          onClick={() => {
                                            copyAll(msg.content);
                                            setCopiedMessageId(msg.id);
                                            if (copyTimeoutRef.current)
                                              clearTimeout(
                                                copyTimeoutRef.current
                                              );
                                            copyTimeoutRef.current = setTimeout(
                                              () => setCopiedMessageId(null),
                                              2000
                                            );
                                          }}
                                          tertiary
                                          tooltip={
                                            copiedMessageId === msg.id
                                              ? "Copied!"
                                              : "Copy"
                                          }
                                        />
                                        {onThreadClick && (() => {
                                            const thread = threadMap?.get(msg.id);
                                            if (thread && (thread.count > 0 || thread.label)) {
                                              return (
                                                <button
                                                  type="button"
                                                  onClick={() => onThreadClick(msg)}
                                                  className="group/thread inline-flex items-center gap-2 px-2 py-1 rounded-lg text-text-03 hover:bg-background-tint-02 transition-colors cursor-pointer"
                                                >
                                                  {selectedAssistant && (
                                                    <div className="w-5 h-5 rounded-[3px] overflow-hidden flex-shrink-0">
                                                      <AgentIcon agent={selectedAssistant} size={20} />
                                                    </div>
                                                  )}
                                                  <span className="text-xs font-medium text-text-05 max-w-[200px] truncate">
                                                    {thread.label
                                                      ? (thread.label.length > 40 ? thread.label.slice(0, 40) + "..." : thread.label)
                                                      : `${thread.count} ${thread.count === 1 ? "reply" : "replies"}`}
                                                  </span>
                                                  {thread.lastReplyAt && (
                                                    <>
                                                      <span className="text-xs text-text-02 group-hover/thread:hidden">
                                                        Last reply {timeAgo(thread.lastReplyAt)}
                                                      </span>
                                                      <span className="text-xs text-text-02 hidden group-hover/thread:inline">
                                                        View thread
                                                      </span>
                                                    </>
                                                  )}
                                                </button>
                                              );
                                            }
                                            return (
                                              <button
                                                type="button"
                                                onClick={() => onThreadClick(msg)}
                                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-text-03 hover:text-text-04 hover:bg-background-tint-02 transition-colors"
                                                title="Continue in thread"
                                              >
                                                <FiMessageSquare className="w-4 h-4" />
                                                <span className="text-xs">Continue in thread</span>
                                              </button>
                                            );
                                          })()}
                                        {renderInlineActions?.(msg)}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}

                              {/* Fallback: tools exist but no display segments yet -- show msg.content if available */}
                              {lastDisplaySegIdx === -1 && msg.content && (
                                <>
                                  <AgentMessageContent
                                    content={msg.content}
                                    docs={citationData.docs}
                                    assistant={selectedAssistant}
                                  />
                                  {isMessageDone && (
                                    <div className="flex items-center gap-x-0.5 mt-1">
                                      <IconButton
                                        icon={
                                          copiedMessageId === msg.id
                                            ? SvgCheck
                                            : SvgCopy
                                        }
                                        onClick={() => {
                                          copyAll(msg.content);
                                          setCopiedMessageId(msg.id);
                                          if (copyTimeoutRef.current)
                                            clearTimeout(
                                              copyTimeoutRef.current
                                            );
                                          copyTimeoutRef.current = setTimeout(
                                            () => setCopiedMessageId(null),
                                            2000
                                          );
                                        }}
                                        tertiary
                                        tooltip={
                                          copiedMessageId === msg.id
                                            ? "Copied!"
                                            : "Copy"
                                        }
                                      />
                                      {onThreadClick && (() => {
                                        const thread = threadMap?.get(msg.id);
                                        if (thread && (thread.count > 0 || thread.label)) {
                                          return (
                                            <button
                                              type="button"
                                              onClick={() => onThreadClick(msg)}
                                              className="group/thread inline-flex items-center gap-2 px-2 py-2 rounded-lg border border-border/40 text-text-03 hover:bg-background-tint-02 transition-colors cursor-pointer"
                                            >
                                              {selectedAssistant && (
                                                <div className="w-5 h-5 rounded-[3px] overflow-hidden flex-shrink-0">
                                                  <AgentIcon agent={selectedAssistant} size={20} />
                                                </div>
                                              )}
                                              <span className="text-xs font-medium text-text-05 max-w-[200px] truncate">
                                                {thread.label
                                                  ? (thread.label.length > 40 ? thread.label.slice(0, 40) + "..." : thread.label)
                                                  : `${thread.count} ${thread.count === 1 ? "reply" : "replies"}`}
                                              </span>
                                              {thread.lastReplyAt && (
                                                <>
                                                  <span className="text-xs text-text-02 group-hover/thread:hidden">Last reply {timeAgo(thread.lastReplyAt)}</span>
                                                  <span className="text-xs text-text-02 hidden group-hover/thread:inline">View thread</span>
                                                </>
                                              )}
                                            </button>
                                          );
                                        }
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => onThreadClick(msg)}
                                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-text-03 hover:text-text-04 hover:bg-background-tint-02 transition-colors"
                                            title="Continue in thread"
                                          >
                                            <FiMessageSquare className="w-4 h-4" />
                                            <span className="text-xs">Continue in thread</span>
                                          </button>
                                        );
                                      })()}
                                      {renderInlineActions?.(msg)}
                                    </div>
                                  )}
                                </>
                              )}
                            </>
                          );
                        })()
                      : msg.toolCalls && msg.toolCalls.length > 0
                        ? (
                            /* Fallback for legacy sessions without packets */
                            <div
                              className="mb-3 space-y-2"
                              data-testid="agent-tool-calls"
                            >
                              {msg.toolCalls.map((toolCall) => (
                                <ToolCallDisplay
                                  key={toolCall.id}
                                  toolCall={toolCall}
                                />
                              ))}
                            </div>
                          )
                        : null}

                    {/* Markdown content -- only when NOT using interleaved rendering */}
                    {!(
                      msg.packets &&
                      msg.packets.length > 0 &&
                      msg.packets.some((p) => p.obj && isToolPacket(p, false))
                    ) &&
                      msg.content &&
                      (() => {
                        const citationData =
                          msg.packets && msg.packets.length > 0
                            ? extractCitationData(msg.packets)
                            : null;
                        return (
                          <>
                            <AgentMessageContent
                              content={msg.content}
                              docs={citationData?.docs}
                              assistant={selectedAssistant}
                            />

                            {/* Copy button + inline actions */}
                            {msg.status === "complete" && (
                              <div className="flex items-center gap-x-0.5 mt-1">
                                <IconButton
                                  icon={
                                    copiedMessageId === msg.id
                                      ? SvgCheck
                                      : SvgCopy
                                  }
                                  onClick={() => {
                                    copyAll(msg.content);
                                    setCopiedMessageId(msg.id);
                                    if (copyTimeoutRef.current) {
                                      clearTimeout(copyTimeoutRef.current);
                                    }
                                    copyTimeoutRef.current = setTimeout(() => {
                                      setCopiedMessageId(null);
                                    }, 2000);
                                  }}
                                  tertiary
                                  tooltip={
                                    copiedMessageId === msg.id
                                      ? "Copied!"
                                      : "Copy"
                                  }
                                />
                                {onThreadClick && (() => {
                                  const thread = threadMap?.get(msg.id);
                                  if (thread && (thread.count > 0 || thread.label)) {
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => onThreadClick(msg)}
                                        className="group/thread inline-flex items-center gap-2 px-2 py-1 rounded-lg border border-border/40 text-text-03 hover:bg-background-tint-02 transition-colors cursor-pointer"
                                      >
                                        {selectedAssistant && (
                                          <div className="w-5 h-5 rounded-[3px] overflow-hidden flex-shrink-0">
                                            <AgentIcon agent={selectedAssistant} size={20} />
                                          </div>
                                        )}
                                        <span className="text-xs font-medium text-text-05 max-w-[200px] truncate">
                                          {thread.label || `${thread.count} ${thread.count === 1 ? "reply" : "replies"}`}
                                        </span>
                                        {thread.lastReplyAt && (
                                          <>
                                            <span className="text-xs text-text-02 group-hover/thread:hidden">Last reply {timeAgo(thread.lastReplyAt)}</span>
                                            <span className="text-xs text-text-02 hidden group-hover/thread:inline">View thread</span>
                                          </>
                                        )}
                                      </button>
                                    );
                                  }
                                  return (
                                    <button
                                      type="button"
                                      onClick={() => onThreadClick(msg)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-text-03 hover:text-text-04 hover:bg-background-tint-02 transition-colors"
                                      title="Continue in thread"
                                    >
                                      <FiMessageSquare className="w-4 h-4" />
                                      <span className="text-xs">Continue in thread</span>
                                    </button>
                                  );
                                })()}
                                {renderInlineActions?.(msg)}
                              </div>
                            )}
                          </>
                        );
                      })()}

                    {/* Extra content injected by parent (e.g., artifact cards) */}
                    {renderMessageExtra?.(msg)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      )}
    </>
  );
}
