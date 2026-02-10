"use client";

import { useState, useEffect } from "react";
import { FiChevronRight, FiChevronDown } from "react-icons/fi";

interface ThinkingIndicatorProps {
  reasoning?: string;
}

export function ThinkingIndicator({
  reasoning,
}: ThinkingIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [thinkingTime, setThinkingTime] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setThinkingTime((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className={`bg-background-tint-02 border border-border rounded-lg overflow-hidden transition-all ${
        reasoning ? "cursor-pointer hover:bg-background-tint-03" : ""
      }`}
      onClick={() => reasoning && setIsExpanded(!isExpanded)}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          {/* Spinner */}
          <div className="w-4 h-4 border-2 border-text-04 border-t-transparent rounded-full animate-spin" />

          {/* Thinking text */}
          <span className="text-base font-medium text-text-04">
            Thinking for {thinkingTime}s
          </span>
        </div>

        {/* Chevron */}
        {reasoning && (
          <div className="text-text-03">
            {isExpanded ? (
              <FiChevronDown className="w-5 h-5" />
            ) : (
              <FiChevronRight className="w-5 h-5" />
            )}
          </div>
        )}
      </div>

      {/* Expandable content */}
      {reasoning && (
        <div
          className={`transition-all duration-300 ease-in-out ${
            isExpanded ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          } overflow-hidden`}
        >
          <div className="px-4 pb-4">
            <div className="text-sm text-text-03 mb-2">Expand for details</div>
            <div className="text-sm text-text-04 leading-relaxed">
              {reasoning}
            </div>
          </div>
        </div>
      )}

      {/* Preview (when collapsed and reasoning exists) */}
      {reasoning && !isExpanded && (
        <div className="px-4 pb-4">
          <div className="text-sm text-text-03 mb-2">Expand for details</div>
          <div className="relative">
            <div className="text-sm text-text-04 leading-relaxed line-clamp-2">
              {reasoning}
            </div>
            {/* Fade effect */}
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background-tint-02 to-transparent pointer-events-none" />
          </div>
        </div>
      )}
    </div>
  );
}
