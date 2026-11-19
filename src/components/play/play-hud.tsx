"use client";

import { LayoutList, Lightbulb, Pause } from "lucide-react";
import { IconButton, IconLink } from "@/components/ui/icon-button";
import { ProgressSegments } from "@/components/ui/progress";
import { PlayMoreMenu } from "@/components/play/play-more-menu";
import { ClueDeliveryBadge, ShuffleBadge } from "@/components/hunts/shuffle-badge";
import type { ClueDelivery } from "@/lib/play/clue-delivery";

interface PlayHudProps {
  stopNumber: number;
  totalStops: number;
  completedStops: number;
  /** The hunt shuffles stop order per player: show the "Shuffled" marker. */
  shuffled?: boolean;
  /** The hunt's clue delivery; when given it picks the marker instead of `shuffled`. */
  delivery?: ClueDelivery;
  /** All clues at once: opens the list of open clues (replaces the stop count). */
  onShowClues?: (() => void) | null;
  /** Clue hint: null hides the button (steps without a clue hint). */
  hint: { available: boolean; onRequest: () => void } | null;
  /** Points one clue hint costs on this hunt's scoring version (2 or 20). */
  hintCost?: number;
  /** "More" menu: Previous stop (null on the first stop) and Report a problem. */
  more: { onPrevious: (() => void) | null; reportTargetId: string; resetKey: string };
}

/**
 * Top bar over the map: pause (back to Home; the session stays active, so
 * this is a pause, not a quit), stop progress, the clue-hint button, and the
 * "More" menu. Stays usable while a step sheet is open.
 */
export function PlayHud({
  stopNumber,
  totalStops,
  completedStops,
  shuffled = false,
  delivery,
  onShowClues = null,
  hint,
  hintCost = 2,
  more,
}: PlayHudProps) {
  const marker = delivery ? (
    <ClueDeliveryBadge mode={delivery} variant="compact" />
  ) : (
    shuffled && <ShuffleBadge variant="compact" />
  );
  return (
    <div className="flex items-center gap-2.5">
      <IconLink href="/dashboard" label="Pause hunt" tone="floating" size="lg" className="bg-white text-ink">
        <Pause className="h-[22px] w-[22px]" strokeWidth={2.6} aria-hidden="true" />
      </IconLink>

      <div className="flex h-[52px] min-w-0 flex-1 flex-col justify-center gap-1.5 rounded-full bg-white px-[18px] text-ink shadow-raised">
        <span className="flex items-center justify-between gap-2">
          {onShowClues ? (
            <button
              type="button"
              onClick={onShowClues}
              className="inline-flex items-center gap-1.5 text-sm font-bold tabular-nums underline-offset-2 hover:underline"
            >
              <LayoutList className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
              All clues · {completedStops} of {totalStops} found
            </button>
          ) : (
            <span className="text-sm font-bold tabular-nums">
              Stop {stopNumber} of {totalStops}
            </span>
          )}
          {!onShowClues && marker}
        </span>
        <ProgressSegments total={totalStops} done={completedStops} current={stopNumber} height={5} className="gap-[3px]" />
      </div>

      {hint ? (
        <IconButton
          label={hint.available ? `Get a clue hint (costs ${hintCost} points)` : "No more clue hints for this stop"}
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
              −{hintCost}
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
