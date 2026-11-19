import { ApiError } from "@/lib/utils/api-auth";
import { hidesPlace, type NavigationHelp } from "@/lib/play/navigation-help";
import type { CompletionRow } from "./completions";

/**
 * When a stop's challenge, and help with it, is released (issue #15).
 *
 * On Medium and Hard hunts the place is kept off the device. The challenge and
 * its hints are written to be used at the place, so they often say where it
 * is: they wait until the player's arrival is recorded. Easy hunts show the
 * place on the map from the start, so nothing waits there.
 */

export const NOT_ARRIVED_MESSAGE = "This hint is available once you've arrived at the stop.";

export const PHOTO_ARRIVAL_MESSAGE =
  "This hint isn't available after a photo check-in on this hunt. Use the challenge's own hints instead.";

type Progress = Pick<CompletionRow, "arrived_at" | "completed_at" | "metadata">;

/** A hint level from a request body: a whole number from 1 to 4, 1 for anything else. */
export function clampHintLevel(level: unknown): number {
  if (typeof level !== "number" || !Number.isFinite(level)) return 1;
  return Math.max(1, Math.min(4, Math.trunc(level)));
}

/** Has the player arrived at (or finished) the stop? */
export function hasArrived(completion: Pick<Progress, "arrived_at" | "completed_at">): boolean {
  return !!completion.arrived_at || !!completion.completed_at;
}

/** 409 on a Medium or Hard hunt until the player has arrived at the stop. */
export function assertChallengeReleased(level: NavigationHelp, completion: Progress): void {
  if (hidesPlace(level) && !hasArrived(completion)) throw new ApiError(409, NOT_ARRIVED_MESSAGE);
}

/**
 * The arrival was a photo check-in nobody has confirmed: the route did not
 * check the player's location at all (see ../[huntId]/arrive-photo).
 */
export function isUnconfirmedPhotoArrival(completion: Pick<Progress, "metadata">): boolean {
  const metadata = completion.metadata ?? {};
  return metadata.arrival_method === "photo" && metadata.arrival_review === "pending";
}

/**
 * For help that is written from the place's name (the AI hint): as
 * assertChallengeReleased, and on a Medium or Hard hunt an unconfirmed photo
 * check-in does not count as having arrived. Otherwise a photo of anything
 * would get the place named.
 */
export function assertPlaceHelpReleased(level: NavigationHelp, completion: Progress): void {
  assertChallengeReleased(level, completion);
  if (hidesPlace(level) && !completion.completed_at && isUnconfirmedPhotoArrival(completion)) {
    throw new ApiError(409, PHOTO_ARRIVAL_MESSAGE);
  }
}
