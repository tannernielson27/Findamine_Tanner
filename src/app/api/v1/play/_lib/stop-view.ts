import { redactContent } from "../../hunts/redact-finds";
import type { Find } from "@/lib/play/play-types";

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
 * them start it now; only then does the primer come along.
 */
export function lockedStopView(source: StopSource, open: boolean): Find {
  return {
    id: source.id,
    sort_order: source.sort_order ?? 0,
    started_at: null,
    open,
    clue_text: null,
    hot_cold_enabled: null,
    scaffolding_level: null,
    reading_check: null,
    locations: null,
    tasks: null,
    primers: open ? primerOf(source) : null,
  };
}

/** A stop the player has started: everything the play screen shows for it. */
export function startedStopView(source: StopSource, startedAt: string): Find {
  const place = one(source.locations);
  const task = one(source.tasks);
  return {
    id: source.id,
    sort_order: source.sort_order ?? 0,
    started_at: startedAt,
    open: true,
    clue_text: source.clue_text ?? null,
    hot_cold_enabled: source.hot_cold_enabled !== false,
    scaffolding_level: source.scaffolding_level ?? null,
    reading_check: source.reading_check ?? null,
    locations: place
      ? {
          name: place.name,
          latitude: place.latitude,
          longitude: place.longitude,
          radius_meters: place.radius_meters ?? 50,
          safety_notes: place.safety_notes ?? null,
        }
      : null,
    tasks: task
      ? { title: task.title, challenge_type: task.challenge_type, content: redactContent(task.content ?? {}) }
      : null,
    primers: primerOf(source),
  };
}
