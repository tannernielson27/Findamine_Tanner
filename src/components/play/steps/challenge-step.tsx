"use client";

import { ThumbsDown, ThumbsUp } from "lucide-react";
import ChallengeInput from "@/components/play/challenge-input";
import type { StopFlow } from "@/lib/play/use-stop-flow";
import type { Find } from "@/lib/play/play-types";

interface ChallengeStepProps {
  huntId: string | undefined;
  find: Find | undefined;
  flow: StopFlow;
}

export function ChallengeStep({ huntId, find, flow }: ChallengeStepProps) {
  const { hints, feedback, canRetry, answer, setAnswer, handleSubmitAnswer, submitting } = flow;
  return (
    <div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Challenge</h2>

      {find?.tasks && (
        <div className="rounded-xl border-l-4 border-secondary bg-themed-bg p-4 mb-4">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text">
            {find.tasks.title}
          </h3>
        </div>
      )}

      {/* Hint section */}
      {hints.hintText && (
        <div className="rounded-lg border border-link/30 bg-link/10 p-3 mb-4">
          <p className="text-base text-themed-text">
            <strong>Hint (Level {hints.hintLevel}):</strong> {hints.hintText}
          </p>
          {!hints.hintRated && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-sm text-themed-muted" id="hint-helpful-label">Was this helpful?</span>
              <button
                aria-label="Hint was helpful"
                aria-describedby="hint-helpful-label"
                onClick={() => hints.rateHint(1)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-themed-border bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 text-secondary hover:bg-secondary/10"
              >
                <ThumbsUp className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                aria-label="Hint was not helpful"
                aria-describedby="hint-helpful-label"
                onClick={() => hints.rateHint(-1)}
                className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-themed-border bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 text-error hover:bg-error/10"
              >
                <ThumbsDown className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          )}
          {hints.hintRated && <p className="text-sm text-themed-muted mt-1">Thanks for the feedback!</p>}
        </div>
      )}

      {/* Feedback from previous attempt */}
      {feedback && canRetry && (
        <div className={`rounded-lg border p-3 mb-4 text-themed-text ${
          feedback.type === "correct" ? "border-secondary/30 bg-secondary/10" :
          feedback.type === "partial" ? "border-link/30 bg-link/10" :
          "border-warning/30 bg-warning/10"
        }`}>
          <p className="text-base font-semibold">{feedback.main}</p>
          <p className="text-sm mt-1">{feedback.explanation}</p>
        </div>
      )}

      {/* Challenge-type-specific input */}
      <div className="mb-2">
        <ChallengeInput
          challengeType={find?.tasks?.challenge_type || "short_text"}
          content={find?.tasks?.content || {}}
          answer={answer}
          onAnswerChange={setAnswer}
          onSubmit={handleSubmitAnswer}
          disabled={submitting}
          huntId={huntId}
          findId={find?.id}
        />
        {submitting && (
          <p role="status" className="mt-2 text-center text-sm text-themed-muted">Checking your answer...</p>
        )}
      </div>

      <button
        onClick={hints.requestHint}
        disabled={hints.hintLevel >= 4}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-link transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:text-themed-muted"
      >
        {hints.hintLevel === 0 ? "Need a hint?" : hints.hintLevel < 4 ? `Get more help (Level ${hints.hintLevel + 1})` : "No more hints available"}
      </button>
    </div>
  );
}
