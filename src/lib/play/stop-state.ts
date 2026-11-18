/**
 * Client-side stop state for the play loop (issue #16).
 *
 * A stop arrives from the server either locked (not started: no clue, place or
 * challenge) or started. These helpers decide which step a stop opens on and
 * merge fresh server data into the list the play screen holds.
 *
 * Pure: no I/O, unit tested directly.
 */

import type { Find, StopStep } from "@/lib/play/play-types";

/**
 * The step a stop opens on. Not started: the ready step (the primer, or a
 * plain "I'm ready" gate). Started: straight to the clue, because the clock is
 * already running and the start is never asked for twice.
 */
export function initialStep(find: Find, completed: boolean): StopStep {
  if (completed) return "feedback";
  return find.started_at ? "clue" : "prime";
}

/** Where "I'm ready" leads once the server has started the stop. */
export function stepAfterStart(find: Find): StopStep {
  const check = find.reading_check;
  return check?.enabled && check.questions?.length > 0 ? "reading_check" : "clue";
}

/** The list with a just-started stop's details in place. Never mutates. */
export function withStartedStop(stops: ReadonlyArray<Find>, started: Find): Find[] {
  return stops.map((stop) => (stop.id === started.id ? started : stop));
}

/**
 * A fresh list from the server merged over the current one. The server's
 * order wins. A stop that is already started here keeps its object (effects
 * keyed on the current stop, like GPS tracking, must not restart) and is never
 * replaced by a locked copy. Never mutates.
 */
export function mergeStops(current: ReadonlyArray<Find>, fresh: ReadonlyArray<Find>): Find[] {
  const known = new Map(current.map((stop) => [stop.id, stop]));
  return fresh.map((stop) => {
    const existing = known.get(stop.id);
    return existing?.started_at ? existing : stop;
  });
}
