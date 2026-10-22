"use client";

import type { ChallengeFieldProps } from "./types";

export function TextInput({
  challengeType,
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeFieldProps & { challengeType: string }) {
  const isLongForm = ["creative_writing", "data_collection", "team_debate"].includes(challengeType);
  const question = (content.question as string) || (content.text as string) || "";

  return (
    <div>
      {question && (
        <p className="text-base text-themed-text mb-3">{question}</p>
      )}
      {isLongForm ? (
        <textarea
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer..."
          disabled={disabled}
          rows={5}
          aria-label={question || "Your answer"}
          className="w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 mb-3 resize-y"
        />
      ) : (
        <input
          type="text"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer..."
          disabled={disabled}
          aria-label={question || "Your answer"}
          className="min-h-12 w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 mb-3"
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      )}
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit
      </button>
    </div>
  );
}
