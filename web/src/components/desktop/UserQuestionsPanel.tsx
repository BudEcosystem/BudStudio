"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { UserQuestionItem } from "@/app/chat/services/streamingModels";
import {
  ChevronLeft,
  ChevronRight,
  X,
  ArrowRight,
  Pencil,
} from "lucide-react";

export interface UserQuestionsPanelProps {
  questions: UserQuestionItem[];
  toolCallId: string;
  sessionId: string;
  onSubmitted: () => void;
}

/**
 * UserQuestionsPanel - Paginated single-question-at-a-time panel.
 *
 * Shows one question per step with numbered option rows,
 * a "Something else" free-text input, Skip, and keyboard navigation.
 * Selecting an option auto-advances to the next question.
 * After the last question, all answers are submitted.
 */
export function UserQuestionsPanel({
  questions,
  toolCallId,
  sessionId,
  onSubmitted,
}: UserQuestionsPanelProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [focusedOption, setFocusedOption] = useState(0);
  const [customText, setCustomText] = useState("");
  const [isCustomFocused, setIsCustomFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const customInputRef = useRef<HTMLInputElement>(null);

  const total = questions.length;
  const currentQuestion = questions[currentIndex];
  const optionCount = currentQuestion?.options.length ?? 0;

  // Submit all answers to backend
  const submitAnswers = useCallback(
    async (finalSelections: Record<number, string>) => {
      if (submitting) return;
      setSubmitting(true);

      const answers = questions.map((q, idx) => ({
        question: q.question,
        answer: finalSelections[idx] ?? "skipped",
      }));

      try {
        const response = await fetch(`/api/agent/sessions/${sessionId}/tool-result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool_call_id: toolCallId,
            output: JSON.stringify(answers),
          }),
        });

        if (!response.ok) {
          throw new Error(`Server responded with ${response.status}`);
        }
        onSubmitted();
      } catch (err) {
        console.error("Failed to submit user answers:", err);
        setSubmitting(false);
      }
    },
    [submitting, questions, sessionId, toolCallId, onSubmitted]
  );

  // Advance to next question or submit if last
  const advance = useCallback(
    (updatedSelections: Record<number, string>) => {
      if (currentIndex < total - 1) {
        setCurrentIndex((i) => i + 1);
        setFocusedOption(0);
        setCustomText("");
        setIsCustomFocused(false);
      } else {
        submitAnswers(updatedSelections);
      }
    },
    [currentIndex, total, submitAnswers]
  );

  // Select an option and auto-advance
  const handleSelect = useCallback(
    (option: string) => {
      const updated = { ...selections, [currentIndex]: option };
      setSelections(updated);
      advance(updated);
    },
    [selections, currentIndex, advance]
  );

  // Skip current question
  const handleSkip = useCallback(() => {
    advance(selections);
  }, [selections, advance]);

  // Submit custom text
  const handleCustomSubmit = useCallback(() => {
    if (!customText.trim()) return;
    handleSelect(customText.trim());
  }, [customText, handleSelect]);

  // Close / dismiss the panel entirely (skip all remaining)
  const handleClose = useCallback(() => {
    submitAnswers(selections);
  }, [selections, submitAnswers]);

  // Navigate between questions
  const goBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      setFocusedOption(0);
      setCustomText("");
      setIsCustomFocused(false);
    }
  }, [currentIndex]);

  const goForward = useCallback(() => {
    if (currentIndex < total - 1) {
      setCurrentIndex((i) => i + 1);
      setFocusedOption(0);
      setCustomText("");
      setIsCustomFocused(false);
    }
  }, [currentIndex, total]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if custom input is focused (let it type normally)
      // except for Escape and Enter
      if (isCustomFocused && e.key !== "Escape" && e.key !== "Enter") return;

      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          setFocusedOption((prev) => Math.max(0, prev - 1));
          setIsCustomFocused(false);
          break;
        case "ArrowDown":
          e.preventDefault();
          if (focusedOption < optionCount - 1) {
            setFocusedOption((prev) => prev + 1);
            setIsCustomFocused(false);
          } else {
            // Move focus to custom input
            setIsCustomFocused(true);
            customInputRef.current?.focus();
          }
          break;
        case "Enter":
          e.preventDefault();
          if (isCustomFocused && customText.trim()) {
            handleCustomSubmit();
          } else if (!isCustomFocused && focusedOption < optionCount) {
            handleSelect(currentQuestion.options[focusedOption]);
          }
          break;
        case "Escape":
          e.preventDefault();
          handleSkip();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    focusedOption,
    optionCount,
    isCustomFocused,
    customText,
    currentQuestion,
    handleSelect,
    handleSkip,
    handleCustomSubmit,
  ]);

  if (!currentQuestion || submitting) return null;

  return (
    <div
      className="flex flex-col"
      data-testid="user-questions-panel"
    >
      {/* Header: question text + pagination + close */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-white">
          {currentQuestion.question}
        </h3>
        <div className="flex items-center gap-1 ml-4 shrink-0">
          <button
            type="button"
            onClick={goBack}
            disabled={currentIndex === 0}
            className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            aria-label="Previous question"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs text-neutral-400 tabular-nums whitespace-nowrap">
            {currentIndex + 1} of {total}
          </span>
          <button
            type="button"
            onClick={goForward}
            disabled={currentIndex === total - 1}
            className="p-0.5 rounded hover:bg-white/10 disabled:opacity-30 transition-colors"
            aria-label="Next question"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-0.5 rounded hover:bg-white/10 ml-1 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Options list */}
      <div className="flex flex-col gap-1">
        {currentQuestion.options.map((option, idx) => {
          const isFocused = !isCustomFocused && focusedOption === idx;
          const isSelected = selections[currentIndex] === option;
          return (
            <button
              key={`${currentIndex}-${idx}`}
              type="button"
              onClick={() => handleSelect(option)}
              onMouseEnter={() => {
                setFocusedOption(idx);
                setIsCustomFocused(false);
              }}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors
                ${isFocused ? "bg-white/10" : isSelected ? "bg-white/5 ring-1 ring-white/20" : "hover:bg-white/5"}
              `}
            >
              <span
                className={`
                  flex items-center justify-center h-6 w-6 rounded-full text-xs font-medium shrink-0
                  ${isFocused ? "bg-white text-black" : "bg-neutral-700 text-neutral-300"}
                `}
              >
                {idx + 1}
              </span>
              <span className="flex-1 text-sm">{option}</span>
              {isFocused && (
                <ArrowRight className="h-4 w-4 text-neutral-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* "Something else" free-text row */}
      <div className="flex items-center gap-3 mt-1 px-3 py-2.5 rounded-lg hover:bg-white/5 transition-colors">
        <span className="flex items-center justify-center h-6 w-6 rounded-full bg-neutral-700 text-neutral-300 shrink-0">
          <Pencil className="h-3 w-3" />
        </span>
        <input
          ref={customInputRef}
          type="text"
          placeholder="Something else"
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          onFocus={() => setIsCustomFocused(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && customText.trim()) {
              e.preventDefault();
              e.stopPropagation();
              handleCustomSubmit();
            }
          }}
          className="flex-1 bg-transparent text-sm text-neutral-300 placeholder-neutral-500 outline-none"
        />
        <button
          type="button"
          onClick={handleSkip}
          className="text-xs font-medium text-neutral-400 hover:text-white px-2.5 py-1 rounded border border-neutral-600 hover:border-neutral-400 transition-colors shrink-0"
        >
          Skip
        </button>
      </div>

      {/* Footer: keyboard shortcuts */}
      <div className="flex items-center justify-center gap-3 mt-3 pt-3 border-t border-neutral-700/50">
        <span className="text-[11px] text-neutral-500">
          <kbd className="font-mono">↑↓</kbd> to navigate
        </span>
        <span className="text-neutral-600">·</span>
        <span className="text-[11px] text-neutral-500">
          <kbd className="font-mono">Enter</kbd> to select
        </span>
        <span className="text-neutral-600">·</span>
        <span className="text-[11px] text-neutral-500">
          <kbd className="font-mono">Esc</kbd> to skip
        </span>
      </div>
    </div>
  );
}

export default UserQuestionsPanel;
