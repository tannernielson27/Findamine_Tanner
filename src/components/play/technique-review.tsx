"use client";

import { useState } from "react";
import { postJson } from "@/lib/play/play-api";

const STRATEGIES = [
  { key: "read_carefully", label: "Read carefully" },
  { key: "used_hint", label: "Used a hint" },
  { key: "talked_with_team", label: "Talked with team" },
  { key: "tried_and_learned", label: "Tried & learned" },
  { key: "remembered", label: "Remembered from primer" },
  { key: "guessed", label: "Guessed" },
];

const CONFIDENCE = [
  { emoji: "😞", label: "Not confident" },
  { emoji: "😐", label: "Somewhat confident" },
  { emoji: "😊", label: "Very confident" },
];

interface TechniqueReviewProps {
  huntId: string | string[] | undefined;
  onError: (message: string) => void;
}

/**
 * Optional post-challenge reflection. Key it on the stop so it starts fresh
 * at every stop. Posts { hunt_id, confidence 1-3, strategies } once.
 */
export function TechniqueReview({ huntId, onError }: TechniqueReviewProps) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [strategies, setStrategies] = useState<string[]>([]);

  async function submit(confidence: number) {
    const ok = await postJson("/api/v1/technique-review", {
      hunt_id: huntId,
      confidence,
      strategies,
    });
    if (!ok) {
      onError("We couldn't save your reflection. Please try again.");
      return;
    }
    setDone(true);
    setOpen(false);
  }

  if (done) return <p className="text-sm text-secondary mt-2">Thanks for reflecting!</p>;

  return (
    <div className="mt-3">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-link underline-offset-2 transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Reflect on your approach (optional)
        </button>
      ) : (
        <div className="rounded-lg border border-link/30 bg-link/10 p-3">
          <p className="text-sm font-semibold text-themed-text mb-2" id="review-strategies-label">What helped you?</p>
          <div className="flex flex-wrap gap-2 mb-3" role="group" aria-labelledby="review-strategies-label">
            {STRATEGIES.map((s) => {
              const selected = strategies.includes(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() =>
                    setStrategies((prev) => (prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key]))
                  }
                  className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                    selected ? "border-link bg-link text-white" : "border-themed-border bg-surface text-themed-text hover:bg-themed-bg"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="text-sm font-semibold text-themed-text mb-1" id="review-confidence-label">How confident are you?</p>
          <div className="flex gap-2 mb-2" role="group" aria-labelledby="review-confidence-label">
            {CONFIDENCE.map((c, i) => (
              <button
                key={i}
                type="button"
                aria-label={c.label}
                className="inline-flex h-12 w-12 items-center justify-center rounded-lg text-2xl leading-none transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                onClick={() => void submit(i + 1)}
              >
                <span aria-hidden="true">{c.emoji}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
