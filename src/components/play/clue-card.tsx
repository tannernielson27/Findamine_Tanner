"use client";

import { Footprints } from "lucide-react";
import { SAFETY_REMINDER } from "@/lib/play/safety";
import type { StopHints } from "@/lib/play/use-stop-hints";

interface ClueCardProps {
  clue: string | null;
  /** Where the stop is ("Heading to: …"), when the creator named it. */
  placeName: string | null;
  hints: StopHints;
  /** The walking-safety line, shown while the player is navigating. */
  showSafetyReminder: boolean;
}

/** Ink clue card in the thumb zone, with any unlocked clue hint underneath. */
export function ClueCard({ clue, placeName, hints, showSafetyReminder }: ClueCardProps) {
  return (
    <section
      aria-label="Clue"
      className="flex flex-col gap-1 rounded-[20px] bg-ink px-[18px] py-3.5 text-white shadow-[0_8px_24px_rgb(28_36_48/0.22)]"
    >
      <span className="text-[13px] font-bold tracking-[0.06em] text-on-ink-accent">CLUE</span>
      <p className="text-lg font-medium leading-[1.4]">{clue || "Head to the next location!"}</p>
      {placeName && <p className="text-base text-on-ink-muted">Heading to: {placeName}</p>}

      {hints.clueHintText && (
        <div className="mt-2 border-t border-white/15 pt-2">
          <span className="text-[13px] font-bold tracking-[0.06em] text-on-ink-accent">CLUE HINT {hints.clueHintLevel}</span>
          <p className="text-base leading-snug">{hints.clueHintText}</p>
        </div>
      )}
      {hints.clueHintsUnavailable && (
        <p role="status" className="mt-1 text-base text-on-ink-muted">There are no clue hints for this stop.</p>
      )}

      {showSafetyReminder && (
        <p className="mt-2 flex items-center gap-1.5 text-[15px] text-on-ink-muted">
          <Footprints className="h-4 w-4 shrink-0" aria-hidden="true" />
          {SAFETY_REMINDER}
        </p>
      )}
    </section>
  );
}
