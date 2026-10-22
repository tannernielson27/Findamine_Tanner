"use client";

import { TechniqueReview } from "@/components/play/technique-review";
import type { AnswerFeedback } from "@/lib/play/play-types";

interface FeedbackStepProps {
  huntId: string | string[] | undefined;
  findId: string | undefined;
  score: number | null;
  hideScores: boolean;
  feedback: AnswerFeedback | null;
  breakdown: Record<string, number> | null;
  alreadyCompleted: boolean;
  onError: (message: string) => void;
}

/** Results for a completed stop: score, feedback, breakdown, optional reflection. */
export function FeedbackStep({ huntId, findId, score, hideScores, feedback, breakdown, alreadyCompleted, onError }: FeedbackStepProps) {
  return (
    <div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Results</h2>

      {score !== null && !hideScores && (
        <div className="text-center mb-4">
          <div className="font-[family-name:var(--font-display)] text-5xl font-bold tabular-nums text-secondary">{score}</div>
          <p className="text-base text-themed-muted">points earned</p>
        </div>
      )}
      {score !== null && hideScores && (
        <div className="text-center mb-4">
          <div className="font-[family-name:var(--font-display)] text-4xl font-bold text-secondary">Complete!</div>
          <p className="text-base text-themed-muted">Great effort on this stop</p>
        </div>
      )}

      {feedback && (
        <div className={`rounded-lg border p-4 mb-4 text-themed-text ${
          feedback.type === "correct" ? "border-secondary/30 bg-secondary/10" :
          feedback.type === "partial" ? "border-link/30 bg-link/10" :
          "border-warning/30 bg-warning/10"
        }`}>
          <p className="text-base font-semibold">{feedback.main}</p>
          <p className="text-base mt-1">{feedback.explanation}</p>
          <p className="text-sm mt-2 italic text-themed-muted">{feedback.next_steps}</p>
        </div>
      )}

      {breakdown && (
        <div className="space-y-2 mb-4">
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-lg border border-themed-border bg-themed-bg p-2">
              <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{breakdown.correctness}</div>
              <div className="text-themed-muted">Accuracy</div>
            </div>
            <div className="rounded-lg border border-themed-border bg-themed-bg p-2">
              <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{breakdown.masteryBonus}</div>
              <div className="text-themed-muted">Mastery</div>
            </div>
            <div className="rounded-lg border border-themed-border bg-themed-bg p-2">
              <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{breakdown.completion}</div>
              <div className="text-themed-muted">Completion</div>
            </div>
          </div>
          {/* hintPenalty is the server's total: clue hints plus challenge hints */}
          {breakdown.hintPenalty > 0 && (
            <div className="text-sm tabular-nums text-themed-muted text-center">
              Hints used: -{breakdown.hintPenalty} pts
            </div>
          )}
        </div>
      )}

      {/* Technique review (optional post-challenge reflection) */}
      {score !== null && <TechniqueReview key={findId} huntId={huntId} onError={onError} />}

      {/* Show "completed" for revisited finds that have no live score */}
      {score === null && alreadyCompleted && (
        <div className="text-center py-8 text-themed-muted">
          <p className="text-base">You already completed this stop.</p>
        </div>
      )}
    </div>
  );
}
