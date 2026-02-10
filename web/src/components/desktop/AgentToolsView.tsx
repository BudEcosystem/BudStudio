"use client";

import { useState, useEffect } from "react";
import {
  TOOL_CATALOG,
  ToolCatalogEntry,
} from "@/lib/agent/tools/tool-catalog";
import { AgentToolsSkeleton } from "./AgentToolsSkeleton";

function ToolCard({ tool }: { tool: ToolCatalogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-border rounded-lg p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text-04 font-mono text-sm">
            {tool.name}
          </span>
          {tool.requiresApproval && (
            <span className="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full">
              Requires Approval
            </span>
          )}
        </div>
        <button
          className="text-xs text-text-02 hover:text-text-04 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide params" : "Show params"}
        </button>
      </div>
      <p className="text-sm text-text-03 mt-1">{tool.description}</p>
      {expanded && tool.parameters.length > 0 && (
        <div className="mt-3 space-y-2">
          {tool.parameters.map((param) => (
            <div
              key={param.name}
              className="text-xs bg-background-tint-01 rounded p-2"
            >
              <span className="font-mono font-medium text-text-04">
                {param.name}
              </span>
              <span className="text-text-02 ml-1">({param.type})</span>
              {param.required && (
                <span className="text-red-500 ml-1">*</span>
              )}
              <p className="text-text-02 mt-0.5">{param.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AgentToolsView() {
  const [isLoading, setIsLoading] = useState(true);
  const localTools = TOOL_CATALOG.filter((t) => t.category === "local");
  const remoteTools = TOOL_CATALOG.filter((t) => t.category === "remote");

  useEffect(() => {
    // Simulate loading time for tool catalog
    const timer = setTimeout(() => setIsLoading(false), 500);
    return () => clearTimeout(timer);
  }, []);

  if (isLoading) {
    return <AgentToolsSkeleton />;
  }

  return (
    <div className="flex-1 h-full overflow-y-auto">
      <div className="px-4 md:px-12 pt-24 pb-4">
        <h1 className="text-2xl font-bold text-text-04 mb-1">
          Available Tools
        </h1>
        <p className="text-sm text-text-02 mb-8">
          Tools available to the Bud Agent during conversations.
        </p>

        <section className="mb-8">
          <h2 className="text-lg font-semibold text-text-04 mb-1">
            Local Tools
          </h2>
          <p className="text-xs text-text-02 mb-4">
            Executed on your device
          </p>
          <div className="space-y-3">
            {localTools.map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-text-04 mb-1">
            Remote Tools
          </h2>
          <p className="text-xs text-text-02 mb-4">
            Executed on the server
          </p>
          <div className="space-y-3">
            {remoteTools.map((tool) => (
              <ToolCard key={tool.name} tool={tool} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
