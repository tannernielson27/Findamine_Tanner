/**
 * Copy for the hunt in progress, shared by the Home resume card and the
 * active-hunt mini-bar. Pure, so the edge cases are unit tested.
 *
 * Edge case: a session can still be active after its last stop is done (the
 * player never pressed "Finish hunt"). Then "Stop 4 of 4" with every segment
 * full reads like a stop is left, so the label says "All stops done" and the
 * action becomes "Finish hunt" (same href: the play screen finishes it).
 */
import type { ActiveHunt } from "@/lib/play/active-hunt";

export type ActiveHuntProgress = Pick<ActiveHunt, "currentStop" | "totalStops" | "completedStops">;

export interface ActiveHuntLabels {
  /** True when every stop is complete but the session is still open. */
  allStopsDone: boolean;
  /** "Stop 3 of 7", "Stop 2" (no total known), or "All stops done". */
  stopLabel: string;
  /** Primary button text: "Resume hunt" or "Finish hunt". */
  actionLabel: "Resume hunt" | "Finish hunt";
  /** Compact button text for tight spaces (mini-bar): "Resume" or "Finish". */
  shortActionLabel: "Resume" | "Finish";
}

/** Every stop finished while the session is still active. */
export function isAllStopsDone(hunt: ActiveHuntProgress): boolean {
  return hunt.totalStops > 0 && hunt.completedStops >= hunt.totalStops;
}

/** "Stop 3 of 7" (clamped to the total), "Stop 2" without a total, or "All stops done". */
export function activeHuntStopLabel(hunt: ActiveHuntProgress): string {
  if (isAllStopsDone(hunt)) return "All stops done";
  if (hunt.totalStops <= 0) return `Stop ${hunt.currentStop}`;
  return `Stop ${Math.min(hunt.currentStop, hunt.totalStops)} of ${hunt.totalStops}`;
}

/** All labels for the hunt in progress. */
export function activeHuntLabels(hunt: ActiveHuntProgress): ActiveHuntLabels {
  const done = isAllStopsDone(hunt);
  return {
    allStopsDone: done,
    stopLabel: activeHuntStopLabel(hunt),
    actionLabel: done ? "Finish hunt" : "Resume hunt",
    shortActionLabel: done ? "Finish" : "Resume",
  };
}
