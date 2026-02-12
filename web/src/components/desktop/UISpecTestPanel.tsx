"use client";

import { useState, useEffect, useCallback } from "react";
import { RichContent } from "@/lib/agent/ui-spec";
import { FiX, FiChevronDown, FiChevronRight } from "react-icons/fi";

interface UISpecConvertResponse {
  spec: Record<string, unknown> | null;
  raw_llm_output: string;
}

export function UISpecTestPanel({ onClose }: { onClose: () => void }) {
  const [catalogPrompt, setCatalogPrompt] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingPrompt, setIsLoadingPrompt] = useState(true);
  const [result, setResult] = useState<UISpecConvertResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);

  // Fetch catalog prompt on mount
  useEffect(() => {
    async function fetchPrompt() {
      try {
        const res = await fetch("/api/agent/ui-spec/catalog-prompt");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setCatalogPrompt(data.prompt);
      } catch (e) {
        setError(`Failed to load catalog prompt: ${e}`);
      } finally {
        setIsLoadingPrompt(false);
      }
    }
    fetchPrompt();
  }, []);

  const handleConvert = useCallback(async () => {
    if (!sampleText.trim()) return;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/agent/ui-spec/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          custom_prompt: catalogPrompt || null,
        }),
      });

      if (!res.ok) {
        const detail = await res.text();
        throw new Error(`HTTP ${res.status}: ${detail}`);
      }

      const data: UISpecConvertResponse = await res.json();
      setResult(data);
    } catch (e) {
      setError(`Conversion failed: ${e}`);
    } finally {
      setIsLoading(false);
    }
  }, [sampleText, catalogPrompt]);

  return (
    <div className="fixed inset-y-0 right-0 w-[560px] z-50 flex flex-col border-l border-border bg-background shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h2 className="text-sm font-semibold">UI Spec Test Panel</h2>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-background-emphasis transition-colors"
        >
          <FiX className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 default-scrollbar">
        {/* Catalog Prompt */}
        <div>
          <label className="block text-xs font-medium text-text-subtle mb-1">
            Catalog Prompt
          </label>
          {isLoadingPrompt ? (
            <div className="h-32 rounded border border-border bg-background-emphasis animate-pulse" />
          ) : (
            <textarea
              value={catalogPrompt}
              onChange={(e) => setCatalogPrompt(e.target.value)}
              className="w-full h-32 rounded border border-border bg-background p-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="Catalog prompt will load here..."
            />
          )}
        </div>

        {/* Sample Text */}
        <div>
          <label className="block text-xs font-medium text-text-subtle mb-1">
            Sample Agent Response Text
          </label>
          <textarea
            value={sampleText}
            onChange={(e) => setSampleText(e.target.value)}
            className="w-full h-40 rounded border border-border bg-background p-2 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-purple-500"
            placeholder="Paste sample agent response text here..."
          />
        </div>

        {/* Convert Button */}
        <button
          onClick={handleConvert}
          disabled={isLoading || !sampleText.trim()}
          className="w-full py-2 px-4 rounded bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Converting...
            </>
          ) : (
            "Convert"
          )}
        </button>

        {/* Error */}
        {error && (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            {error}
          </div>
        )}

        {/* Result Preview */}
        {result && (
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-medium text-text-subtle mb-2">
                Preview
              </h3>
              {result.spec ? (
                <div className="rounded border border-border bg-background-emphasis p-3 overflow-auto">
                  <RichContent spec={result.spec} />
                </div>
              ) : (
                <div className="rounded border border-border bg-background-emphasis p-3 text-xs text-text-subtle">
                  No spec returned (null). Check the raw LLM output below.
                </div>
              )}
            </div>

            {/* Raw Output Toggle */}
            <div>
              <button
                onClick={() => setShowRawOutput(!showRawOutput)}
                className="flex items-center gap-1 text-xs text-text-subtle hover:text-text-default transition-colors"
              >
                {showRawOutput ? (
                  <FiChevronDown className="w-3 h-3" />
                ) : (
                  <FiChevronRight className="w-3 h-3" />
                )}
                Raw LLM Output
              </button>
              {showRawOutput && (
                <pre className="mt-1 rounded border border-border bg-background p-2 text-xs font-mono overflow-auto max-h-60 whitespace-pre-wrap">
                  {result.raw_llm_output}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
