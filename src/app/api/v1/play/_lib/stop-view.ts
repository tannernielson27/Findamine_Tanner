import { redactContent } from "../../hunts/redact-finds";
import type { Find } from "@/lib/play/play-types";
import { navigationAids, type NavigationHelp } from "@/lib/play/navigation-help";

/**
 * What the play API tells a player about a stop (issue #16).
 *
 * Before the player starts a stop they get its id, its place in their order
 * and, once their clue order has reached it, its primer (the "before you
 * start" reading). Everything that says where the stop is stays on the server:
 * the clue, the place (name, coordinates, radius, safety note), the challenge
 * and the reading check.
 *
 * After the start they get what the play screen needs, built field by field so
 * a new column on finds/locations is never sent by accident. Never sent at
 * all: answer keys (graded server-side), the clue hint list (handed out one at
 * a time by /clue-hint, at a cost) and the place's address or description.
 *
 * The hunt's navigation help level (issue #15, lib/play/navigation-help.ts)
 * decides how much of the place a started stop carries. Easy: all of it.
 * Medium and Hard: the place's name and coordinates stay on the server until
 * the player has completed the stop, so there is nothing on the device to
 * draw a map, a pin or a direction from, and the challenge stays on the
 * server until they have arrived. In Hard the stop also says its hot/cold
 * meter is off. The creator's safety note is sent at every level: it is for
 * the way there.
 */

type One<T> = T | T[] | null | undefined;
const one = <T,>(value: One<T>): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

interface PlaceRow {
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number | null;
  safety_notes?: string | null;
}

interface TaskRow {
  title: string;
  challenge_type: string;
  content: Record<string, unknown> | null;
}

interface PrimerRow {
  title: string;
  content: Record<string, unknown> | null;
}

/** A finds row with its embeds, as loaded by the stops routes. */
export interface StopSource {
  id: string;
  sort_order: number | null;
  clue_text?: string | null;
  hot_cold_enabled?: boolean | null;
  scaffolding_level?: string | null;
  reading_check?: Find["reading_check"];
  locations?: One<PlaceRow>;
  tasks?: One<TaskRow>;
  primers?: One<PrimerRow>;
}

/** Columns the stop views are built from. `*` keeps working on a database missing a newer finds column. */
export const STOP_SOURCE_COLUMNS = "*, locations(*), tasks(*), primers(*)";

function primerOf(source: StopSource): Find["primers"] {
  const primer = one(source.primers);
  return primer ? { title: primer.title, content: primer.content ?? {} } : null;
}

export function hasPrimer(source: StopSource): boolean {
  return one(source.primers) !== null;
}

/**
 * A stop the player has not started. `open` says whether their clue order lets
 * them start it now; only then does the primer come along. On a scheduled
 * hunt (issue #14) a stop that has not been released carries `release_at`,
 * the time it opens, and nothing else: not even its primer.
 */
export function lockedStopView(source: StopSource, open: boolean, releaseAt: string | null = null): Find {
  return {
    id: source.id,
    sort_order: source.sort_order ?? 0,
    started_at: null,
    open,
    ...(releaseAt ? { release_at: releaseAt } : {}),
    clue_text: null,
    hot_cold_enabled: null,
    scaffolding_level: null,
    reading_check: null,
    locations: null,
    tasks: null,
    primers: open ? primerOf(source) : null,
  };
}

export interface StartedStopOptions {
  navigationHelp: NavigationHelp;
  /** The player's arrival at this stop is recorded. */
  arrived: boolean;
  /** The player has finished this stop: nothing about it is left to find. */
  completed: boolean;
}

/**
 * A stop the player has started: what the play screen may show for it at the
 * hunt's navigation help level.
 *
 * Medium and Hard also hold the challenge back until the player has arrived.
 * A challenge is written to be answered at the place ("What year is on the
 * plaque by the fountain?"), so its title and question often say where that
 * is. `challenge_pending` tells the screen there is one to fetch on arrival
 * (start-stop returns the stop again, with it).
 */
export function startedStopView(source: StopSource, startedAt: string, options: StartedStopOptions): Find {
  const place = one(source.locations);
  const task = one(source.tasks);
  const aids = navigationAids(options.navigationHelp);
  const showPlace = aids.map || options.completed;
  const showChallenge = aids.map || options.arrived || options.completed;
  return {
    id: source.id,
    sort_order: source.sort_order ?? 0,
    started_at: startedAt,
    open: true,
    clue_text: source.clue_text ?? null,
    hot_cold_enabled: aids.meter && source.hot_cold_enabled !== false,
    scaffolding_level: source.scaffolding_level ?? null,
    reading_check: source.reading_check ?? null,
    locations: place
      ? {
          name: showPlace ? place.name : null,
          latitude: showPlace ? place.latitude : null,
          longitude: showPlace ? place.longitude : null,
          radius_meters: place.radius_meters ?? 50,
          safety_notes: place.safety_notes ?? null,
        }
      : null,
    tasks:
      task && showChallenge
        ? { title: task.title, challenge_type: task.challenge_type, content: redactContent(task.content ?? {}) }
        : null,
    ...(task && !showChallenge ? { challenge_pending: true } : {}),
    primers: primerOf(source),
  };
}
