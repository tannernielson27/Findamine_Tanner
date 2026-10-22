"use client";

import type { ChallengeFieldProps } from "./types";

export function NumericEntry({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeFieldProps) {
  const question = (content.question as string) || (content.text as string) || "";
  const unit = (content.unit as string) || "";
  const placeholder = (content.placeholder as string) || "Enter a number...";

  return (
    <div>
      {question && (
        <p className="text-base text-themed-text mb-3">{question}</p>
      )}
      <div className="flex gap-2 mb-4">
        <input
          type="number"
          inputMode="decimal"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={question || "Enter your numeric answer"}
          className="min-h-12 min-w-0 flex-1 tabular-nums rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        {unit && (
          <span className="flex items-center text-base text-themed-muted px-2">{unit}</span>
        )}
      </div>
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Answer
      </button>
    </div>
  );
}
