"use client";

import { useState } from "react";
import { Frown, Meh, Smile, type LucideIcon } from "lucide-react";
import { postJson } from "@/lib/play/play-api";
import { cn } from "@/lib/utils/cn";

const STRATEGIES = [
  { key: "read_carefully", label: "Read carefully" },
  { key: "used_hint", label: "Used a hint" },
  { key: "talked_with_team", label: "Talked with team" },
  { key: "tried_and_learned", label: "Tried & learned" },
  { key: "remembered", label: "Remembered from primer" },
  { key: "guessed", label: "Guessed" },
];

/** Confidence 1-3, in this order. Labels unchanged from the original emoji buttons. */
const CONFIDENCE: { icon: LucideIcon; label: string }[] = [
  { icon: Frown, label: "Not confident" },
  { icon: Meh, label: "Somewhat confident" },
  { icon: Smile, label: "Very confident" },
];

interface TechniqueReviewProps {
  huntId: string | string[] | undefined;
  onError: (message: string) => void;
}

/**
 * Optional post-challenge reflection, on the dark results screen. Key it on
 * the stop so it starts fresh at every stop. Posts { hunt_id, confidence 1-3,
 * strategies } once.
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

  if (done) return <p role="status" className="text-center text-base text-[#D6EFE0]">Thanks for reflecting!</p>;

  if (!open) {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex min-h-12 items-center rounded-xl px-3 text-base font-semibold text-white underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          Reflect on your approach (optional)
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] bg-white/10 p-4 text-white">
      <p className="mb-2 text-base font-bold" id="review-strategies-label">What helped you?</p>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-labelledby="review-strategies-label">
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
              className={cn(
                "inline-flex min-h-12 items-center rounded-full px-4 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                selected ? "bg-white font-bold text-juniper-deep" : "border border-white/40 bg-transparent text-white hover:bg-white/10"
              )}
            >
              {s.label}
            </button>
          );
        })}
      </div>
      <p className="mb-2 text-base font-bold" id="review-confidence-label">How confident are you?</p>
      <div className="flex gap-2" role="group" aria-labelledby="review-confidence-label">
        {CONFIDENCE.map(({ icon: Icon, label }, i) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => void submit(i + 1)}
          >
            <Icon className="h-7 w-7" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}
