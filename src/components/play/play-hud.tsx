"use client";

import { Lightbulb, Pause } from "lucide-react";
import { IconButton, IconLink } from "@/components/ui/icon-button";
import { ProgressSegments } from "@/components/ui/progress";
import { PlayMoreMenu } from "@/components/play/play-more-menu";

interface PlayHudProps {
  stopNumber: number;
  totalStops: number;
  completedStops: number;
  /** Clue hint: null hides the button (steps without a clue hint). */
  hint: { available: boolean; onRequest: () => void } | null;
  /** "More" menu: Previous stop (null on the first stop) and Report a problem. */
  more: { onPrevious: (() => void) | null; reportTargetId: string; resetKey: string };
}

/**
 * Top bar over the map: pause (back to Home; the session stays active, so
 * this is a pause, not a quit), stop progress, the clue-hint button, and the
 * "More" menu. Stays usable while a step sheet is open.
 */
export function PlayHud({ stopNumber, totalStops, completedStops, hint, more }: PlayHudProps) {
  return (
    <div className="flex items-center gap-2.5">
      <IconLink href="/dashboard" label="Pause hunt" tone="floating" size="lg" className="bg-white text-ink">
        <Pause className="h-[22px] w-[22px]" strokeWidth={2.6} aria-hidden="true" />
      </IconLink>

      <div className="flex h-[52px] min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-full bg-white px-[18px] text-ink shadow-raised">
        <span className="text-sm font-bold tabular-nums">
          Stop {stopNumber} of {totalStops}
        </span>
        <ProgressSegments total={totalStops} done={completedStops} current={stopNumber} height={5} className="gap-[3px]" />
      </div>

      {hint ? (
        <IconButton
          label={hint.available ? "Get a clue hint (costs 2 points)" : "No more clue hints for this stop"}
          tone="floating"
          size="lg"
          onClick={hint.onRequest}
          disabled={!hint.available}
          className="bg-white text-ink disabled:text-themed-muted disabled:opacity-70"
        >
          <Lightbulb className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden="true" />
          {hint.available && (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 rounded-full bg-ink px-1.5 py-0.5 text-[11px] font-bold leading-none text-white tabular-nums"
            >
              −2
            </span>
          )}
        </IconButton>
      ) : (
        <span className="h-[52px] w-[52px] shrink-0" aria-hidden="true" />
      )}

      {/* Keyed on stop + step so the menu starts closed at each step. */}
      <PlayMoreMenu key={more.resetKey} onPrevious={more.onPrevious} reportTargetId={more.reportTargetId} />
    </div>
  );
}
