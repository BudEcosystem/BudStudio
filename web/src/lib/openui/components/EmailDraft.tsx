"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import type { ComponentRenderProps } from "@openuidev/react-lang";

interface EmailDraftProps {
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
}

export const EmailDraftRenderer: React.FC<
  ComponentRenderProps<EmailDraftProps>
> = ({ props }) => {
  const { to, cc, subject, body } = props;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="border-b border-gray-100 dark:border-neutral-700 bg-gray-50 dark:bg-neutral-800 px-4 py-2">
        <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Email Draft
        </span>
      </div>

      {/* Meta fields */}
      <div className="space-y-2 border-b border-gray-100 dark:border-neutral-700 px-4 py-3 text-sm">
        {/* To */}
        <div className="flex items-start gap-2">
          <span className="w-12 shrink-0 font-medium text-gray-500 dark:text-gray-400">To:</span>
          <div className="flex flex-wrap gap-1">
            {to.map((addr, i) => (
              <span
                key={i}
                className="inline-block rounded-full bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-300"
              >
                {addr}
              </span>
            ))}
          </div>
        </div>

        {/* CC */}
        {cc && cc.length > 0 && (
          <div className="flex items-start gap-2">
            <span className="w-12 shrink-0 font-medium text-gray-500 dark:text-gray-400">
              CC:
            </span>
            <div className="flex flex-wrap gap-1">
              {cc.map((addr, i) => (
                <span
                  key={i}
                  className="inline-block rounded-full bg-gray-100 dark:bg-neutral-700 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-300"
                >
                  {addr}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Subject */}
        <div className="flex items-start gap-2">
          <span className="w-12 shrink-0 font-medium text-gray-500 dark:text-gray-400">
            Subj:
          </span>
          <span className="font-semibold text-gray-900 dark:text-gray-100">{subject}</span>
        </div>
      </div>

      {/* Body */}
      <div className="prose prose-sm dark:prose-invert max-w-none px-4 py-3 text-gray-800 dark:text-gray-200">
        <ReactMarkdown>{body}</ReactMarkdown>
      </div>
    </div>
  );
};
