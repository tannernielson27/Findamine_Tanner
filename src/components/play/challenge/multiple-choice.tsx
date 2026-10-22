"use client";

import type { ChallengeFieldProps } from "./types";

export function MultipleChoice({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeFieldProps) {
  const options = (content.options as string[]) || [];
  const question = (content.question as string) || (content.text as string) || "";

  return (
    <div>
      {question && (
        <p className="text-base text-themed-text mb-3">{question}</p>
      )}
      <div className="space-y-2 mb-4" role="radiogroup" aria-label={question || "Answer options"}>
        {options.map((option, idx) => {
          const letter = String.fromCharCode(65 + idx); // A, B, C, D
          const isSelected = answer === option;
          return (
            <button
              key={idx}
              role="radio"
              aria-checked={isSelected}
              onClick={() => onAnswerChange(option)}
              disabled={disabled}
              className={`flex min-h-12 w-full items-center text-left rounded-lg border-2 px-4 py-3 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                isSelected
                  ? "border-link bg-link/10 text-themed-text font-semibold"
                  : "border-themed-border bg-surface text-themed-text hover:border-link/50 hover:bg-themed-bg"
              } disabled:opacity-50`}
            >
              <span className={`inline-flex shrink-0 items-center justify-center w-7 h-7 rounded-full text-sm font-bold mr-3 ${isSelected ? "bg-link text-white" : "bg-themed-bg text-themed-muted"}`} aria-hidden="true">
                {letter}
              </span>
              {option}
            </button>
          );
        })}
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
