"use client";

import React, { Component, ReactNode } from "react";
import { JSONUIProvider, Renderer } from "@json-render/react";
import type { Spec } from "@json-render/core";
import { registry } from "./components";

interface RichContentProps {
  spec: Record<string, unknown>;
  fallbackContent?: string;
}

interface ErrorBoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Error boundary that catches rendering errors from malformed specs
 * and falls back to the provided fallback content.
 */
class SpecErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

/**
 * Renders a json-render UI spec using the registered component catalog.
 * Wraps the Renderer in an error boundary that falls back to displaying
 * the raw JSON on error.
 */
export function RichContent({ spec, fallbackContent }: RichContentProps) {
  const fallback = fallbackContent ? (
    <p className="whitespace-pre-wrap text-sm">{fallbackContent}</p>
  ) : (
    <pre className="text-xs text-neutral-500 overflow-auto max-h-60">
      {JSON.stringify(spec, null, 2)}
    </pre>
  );

  return (
    <SpecErrorBoundary fallback={fallback}>
      <JSONUIProvider registry={registry}>
        <Renderer
          spec={spec as unknown as Spec}
          registry={registry}
        />
      </JSONUIProvider>
    </SpecErrorBoundary>
  );
}
