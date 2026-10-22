"use client";

import type { Find } from "@/lib/play/play-types";
import type { StopHints } from "@/lib/play/use-stop-hints";

const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40";

/** The clue hint the player has unlocked, or the "no hints" note. */
export function ClueHintPanel({ hints, className = "mb-4" }: { hints: StopHints; className?: string }) {
  return (
    <>
      {hints.clueHintText && (
        <div className={`rounded-lg border border-link/30 bg-link/10 p-3 ${className}`}>
          <p className="text-sm font-semibold text-link mb-1">Clue Hint {hints.clueHintLevel}</p>
          <p className="text-base text-themed-text">{hints.clueHintText}</p>
        </div>
      )}
      {hints.clueHintsUnavailable && (
        <p role="status" className="text-base text-themed-muted mb-4">There are no clue hints for this stop.</p>
      )}
    </>
  );
}

interface ClueStepProps {
  find: Find | undefined;
  hints: StopHints;
  onStartNavigating: () => void;
}

export function ClueStep({ find, hints, onStartNavigating }: ClueStepProps) {
  return (
    <div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Your Clue</h2>
      <div className="rounded-xl border-l-4 border-secondary bg-themed-bg p-4 mb-4">
        <p className="font-[family-name:var(--font-display)] text-xl leading-snug text-themed-text">
          {find?.clue_text || "Head to the next location!"}
        </p>
      </div>
      {find?.locations && (
        <p className="text-base text-themed-muted mb-4">
          Heading to: {find.locations.name}
        </p>
      )}
      <ClueHintPanel hints={hints} />
      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        {hints.canRequestClueHint ? (
          <button onClick={hints.requestClueHint} className={`${SECONDARY} sm:flex-1`}>
            Need a hint? (-2 pts)
          </button>
        ) : null}
        <button onClick={onStartNavigating} className={`${PRIMARY} sm:flex-1`}>
          Start Navigating
        </button>
      </div>
    </div>
  );
}
