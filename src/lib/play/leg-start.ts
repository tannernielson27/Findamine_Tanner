/**
 * The start of a player's walk to a stop, for the hot/cold meter.
 *
 * The meter is scaled to the leg (lib/services/hot-cold.ts): the server needs
 * to know how far away the player was at their first reading for the stop.
 * The server works that distance out and reports it; the client remembers it
 * and echoes it back with each later reading. It is kept on the device, not
 * in the database, because the privacy policy says the only thing stored from
 * navigation is the arrival. It is a distance, never coordinates.
 *
 * Pure apart from the two storage helpers, which take the storage to use.
 */

import { MAX_USABLE_ACCURACY_M } from "@/lib/play/arrival-check";
import { AWAY_FACTOR } from "@/lib/services/hot-cold";

export interface LegStart {
  /** Metres from the stop at the start of the leg. */
  meters: number;
  /**
   * The start came from a fix too vague to trust (a phone's first fix is often
   * hundreds of metres out). The first usable fix replaces it.
   */
  provisional: boolean;
}

/** After this long a saved start is dropped: a replay or a new day is a new leg. */
export const LEG_START_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const STORAGE_PREFIX = "fm:leg-start:";

type LegStartStorage = Pick<Storage, "getItem" | "setItem">;
type StoredEntry = LegStart & { at: number };

/** True when a fix is too vague to confirm an arrival, so too vague to pin the scale on. */
export function isVagueFix(accuracy: number | null | undefined): boolean {
  return typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy > MAX_USABLE_ACCURACY_M;
}

/**
 * The leg start to send with a reading, or null to let the server treat this
 * reading as the start (the first reading, or the first usable fix after a
 * provisional start).
 */
export function legStartToSend(start: LegStart | null, vague: boolean): number | null {
  if (!start) return null;
  return start.provisional && !vague ? null : start.meters;
}

/**
 * The leg start to keep after a reply, given the distance the server reported.
 *
 * A reading sent without a start sets it. After that it only ever grows, and
 * only on a usable fix: once the player is more than AWAY_FACTOR times the
 * start away (the marker is on the cold end by then) the start follows them
 * out, so the walk back uses the whole meter instead of waiting at the cold
 * end. That also covers a start saved earlier from somewhere much closer.
 */
export function legStartAfterReply(
  start: LegStart | null,
  sent: number | null,
  replyDistance: unknown,
  vague: boolean
): LegStart | null {
  if (typeof replyDistance !== "number" || !Number.isFinite(replyDistance) || replyDistance < 0) return start;
  if (!start || sent === null) return { meters: Math.max(1, Math.round(replyDistance)), provisional: vague };
  if (vague) return start;
  const followed = Math.round(replyDistance / AWAY_FACTOR);
  return followed > start.meters ? { ...start, meters: followed } : start;
}

function browserStorage(): LegStartStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isEntry(value: unknown): value is StoredEntry {
  if (typeof value !== "object" || value === null) return false;
  const { meters, provisional, at } = value as Record<string, unknown>;
  const validMeters = typeof meters === "number" && Number.isFinite(meters) && meters > 0;
  return validMeters && typeof provisional === "boolean" && typeof at === "number" && Number.isFinite(at);
}

/** The hunt's saved starts that are still fresh, by stop id. Never throws. */
function readEntries(huntId: string, now: number, storage: LegStartStorage | null): Record<string, StoredEntry> {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_PREFIX + huntId) ?? "null");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const fresh = Object.entries(parsed).filter(
      (pair): pair is [string, StoredEntry] => isEntry(pair[1]) && now - pair[1].at <= LEG_START_MAX_AGE_MS
    );
    return Object.fromEntries(fresh);
  } catch {
    // Storage blocked (private mode) or not JSON: the meter starts a new leg.
    return {};
  }
}

/** The start saved for this stop, so a reload mid-walk doesn't restart the meter. */
export function loadLegStart(
  huntId: string,
  findId: string,
  now: number = Date.now(),
  storage: LegStartStorage | null = browserStorage()
): LegStart | null {
  const entry = readEntries(huntId, now, storage)[findId];
  return entry ? { meters: entry.meters, provisional: entry.provisional } : null;
}

export function saveLegStart(
  huntId: string,
  findId: string,
  start: LegStart,
  now: number = Date.now(),
  storage: LegStartStorage | null = browserStorage()
): void {
  if (!storage) return;
  try {
    const entries = { ...readEntries(huntId, now, storage), [findId]: { ...start, at: now } };
    storage.setItem(STORAGE_PREFIX + huntId, JSON.stringify(entries));
  } catch {
    // Storage full or blocked: the start still lives in memory for this page.
  }
}

/**
 * Forgets the start saved for a stop. Called when the player arrives: the leg
 * is over, so a replay of the hunt (or walking off and coming back) starts a
 * new one instead of reusing this one.
 */
export function clearLegStart(
  huntId: string,
  findId: string,
  now: number = Date.now(),
  storage: LegStartStorage | null = browserStorage()
): void {
  if (!storage) return;
  try {
    const kept = Object.entries(readEntries(huntId, now, storage)).filter(([id]) => id !== findId);
    storage.setItem(STORAGE_PREFIX + huntId, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Storage blocked: the entry expires on its own.
  }
}
