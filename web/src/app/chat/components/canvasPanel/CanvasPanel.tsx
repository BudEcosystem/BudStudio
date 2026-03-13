"use client";

import React, { memo, useCallback, Component } from "react";
import type { ReactNode } from "react";
import { Renderer } from "@openuidev/react-lang";
import type { ActionEvent } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import { useTheme } from "next-themes";
import { budStudioLibrary } from "@/lib/openui/catalog";
import { handleCanvasAction } from "@/lib/openui/actions";
import "@openuidev/react-ui/components.css";
import { cn } from "@/lib/utils";
import { CanvasHeader } from "@/app/chat/components/canvasPanel/CanvasHeader";
import type { ActiveCanvas } from "@/app/chat/stores/useChatSessionStore";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface CanvasPanelProps {
  activeCanvas: ActiveCanvas | null;
  closeSidebar: () => void;
  sendMessage: (msg: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Error boundary                                                     */
/* ------------------------------------------------------------------ */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RendererErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <p className="font-main-ui-body text-text-03">
            Something went wrong rendering the canvas.
          </p>
          <p className="font-secondary-body text-text-04 max-w-sm break-words">
            {this.state.error?.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  Loading skeleton                                                   */
/* ------------------------------------------------------------------ */

function CanvasSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-4 animate-pulse">
      <div className="h-4 w-3/4 rounded bg-background-neutral-03" />
      <div className="h-4 w-1/2 rounded bg-background-neutral-03" />
      <div className="h-32 w-full rounded bg-background-neutral-03" />
      <div className="h-4 w-2/3 rounded bg-background-neutral-03" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

function CanvasEmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-6 text-center">
      <p className="font-main-ui-muted text-text-04">
        No canvas content. Agent tool results will appear here.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

function CanvasPanelInner({
  activeCanvas,
  closeSidebar,
  sendMessage,
}: CanvasPanelProps) {
  const { resolvedTheme } = useTheme();
  const openUiMode = resolvedTheme === "dark" ? "dark" : "light";

  const onAction = useCallback(
    (event: ActionEvent) => {
      handleCanvasAction(event, sendMessage);
    },
    [sendMessage]
  );

  // No active canvas at all -- show empty state
  if (!activeCanvas) {
    return (
      <div className="h-full w-full bg-background-tint-01 flex flex-col">
        <CanvasHeader title="Canvas" isStreaming={false} onClose={closeSidebar} />
        <ThemeProvider mode={openUiMode}>
          <CanvasEmptyState />
        </ThemeProvider>
      </div>
    );
  }

  const { openui_lang, title, isStreaming } = activeCanvas;

  // Streaming has started but no content has arrived yet -- show skeleton
  const showSkeleton = isStreaming && !openui_lang;

  return (
    <div className="h-full w-full bg-background-tint-01 flex flex-col">
      <CanvasHeader title={title} isStreaming={isStreaming} onClose={closeSidebar} />

      <div className={cn("flex-1 overflow-y-auto p-4", "default-scrollbar")}>
        <ThemeProvider mode={openUiMode}>
          {showSkeleton ? (
            <CanvasSkeleton />
          ) : (
            <RendererErrorBoundary>
              <Renderer
                response={openui_lang}
                library={budStudioLibrary}
                isStreaming={isStreaming}
                onAction={onAction}
              />
            </RendererErrorBoundary>
          )}
        </ThemeProvider>
      </div>
    </div>
  );
}

export const CanvasPanel = memo(CanvasPanelInner);
CanvasPanel.displayName = "CanvasPanel";
