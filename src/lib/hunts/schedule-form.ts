/**
 * The schedule editor's form (issue #14): wall-clock dates and times in the
 * hunt's time zone, turned into the instants the API stores.
 *
 * Pure: no I/O and no clock, unit tested directly.
 */

import {
  DEFAULT_SCHEDULE_TIMEZONE,
  formatInZone,
  fromWallTime,
  isTimeZone,
  readHuntWindow,
  readScheduleTimeZone,
  releasesFromRule,
  toWallTime,
  validateReleaseRule,
  validateSchedule,
  type HuntWindowSource,
  type ReleaseRule,
  type WallTime,
} from "@/lib/hunts/schedule";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ScheduleFormStop {
  findId: string;
  /** When the stop is released, in the form's zone; null means "when the hunt starts". */
  wall: WallTime | null;
}

export interface ScheduleForm {
  timeZone: string;
  start: WallTime;
  end: WallTime;
  /** One entry per stop, in stop order. */
  stops: ScheduleFormStop[];
}

interface FormHunt extends HuntWindowSource {
  metadata?: Record<string, unknown> | null;
}

interface FormStop {
  id: string;
  release_at?: string | null;
}

/** Zones offered in the editor, besides the hunt's own and the creator's device zone. */
export const COMMON_TIME_ZONES = [
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Chicago",
  "America/New_York",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
] as const;

/** The zone list for the picker: the given zones first (when real), then the common ones, no repeats. */
export function timeZoneOptions(...preferred: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set([...preferred.filter(isTimeZone), ...COMMON_TIME_ZONES])];
}

/**
 * The form for a hunt. A scheduled hunt opens with its stored schedule. A
 * play-anytime hunt opens with a starting point: tomorrow at 9:00 for two
 * weeks, in the creator's zone, every stop released at the start.
 */
export function scheduleFormFor(
  hunt: FormHunt,
  stops: ReadonlyArray<FormStop>,
  defaults: { nowMs: number; deviceTimeZone?: string | null }
): ScheduleForm {
  const window = readHuntWindow(hunt);
  if (window) {
    const timeZone = readScheduleTimeZone(hunt.metadata);
    return {
      timeZone,
      start: toWallTime(window.startsAtMs, timeZone),
      end: toWallTime(window.endsAtMs, timeZone),
      stops: stops.map((stop) => {
        const at = stop.release_at ? Date.parse(stop.release_at) : Number.NaN;
        // A release at (or before) the start is the same as none of its own.
        return { findId: stop.id, wall: Number.isFinite(at) && at > window.startsAtMs ? toWallTime(at, timeZone) : null };
      }),
    };
  }
  const timeZone = isTimeZone(defaults.deviceTimeZone) ? defaults.deviceTimeZone : DEFAULT_SCHEDULE_TIMEZONE;
  const tomorrow = toWallTime(defaults.nowMs + DAY_MS, timeZone).date;
  const twoWeeksOn = toWallTime(defaults.nowMs + 15 * DAY_MS, timeZone).date;
  return {
    timeZone,
    start: { date: tomorrow, time: "09:00" },
    end: { date: twoWeeksOn, time: "21:00" },
    stops: stops.map((stop) => ({ findId: stop.id, wall: null })),
  };
}

export interface ScheduleRequestBody {
  starts_at: string;
  ends_at: string;
  timezone: string;
  releases: { find_id: string; release_at: string | null }[];
}

export type ScheduleRequest = { ok: true; body: ScheduleRequestBody } | { ok: false; error: string };

/** The request for PUT /hunts/[id]/schedule, or what is wrong with the form. */
export function scheduleRequest(form: ScheduleForm): ScheduleRequest {
  if (!isTimeZone(form.timeZone)) return { ok: false, error: "Choose a time zone." };
  const startMs = fromWallTime(form.start, form.timeZone);
  const endMs = fromWallTime(form.end, form.timeZone);
  if (startMs === null) return { ok: false, error: "Choose the date and time the hunt starts." };
  if (endMs === null) return { ok: false, error: "Choose the date and time the hunt ends." };

  const releases: ScheduleRequestBody["releases"] = [];
  for (const [index, stop] of form.stops.entries()) {
    if (stop.wall === null) {
      releases.push({ find_id: stop.findId, release_at: null });
      continue;
    }
    const at = fromWallTime(stop.wall, form.timeZone);
    if (at === null) return { ok: false, error: `Choose a date and time for stop ${index + 1}, or release it at the start.` };
    releases.push({ find_id: stop.findId, release_at: new Date(at).toISOString() });
  }

  const body: ScheduleRequestBody = {
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(endMs).toISOString(),
    timezone: form.timeZone,
    releases,
  };
  const check = validateSchedule(
    {
      startsAt: body.starts_at,
      endsAt: body.ends_at,
      timeZone: body.timezone,
      releases: releases.map((r) => ({ findId: r.find_id, releaseAt: r.release_at })),
    },
    form.stops.map((s) => s.findId)
  );
  return check.ok ? { ok: true, body } : { ok: false, error: check.error };
}

export type RuleResult = { ok: true; form: ScheduleForm } | { ok: false; error: string };

/** The form with every stop's release filled in from the rule, in stop order. Never mutates. */
export function applyReleaseRule(form: ScheduleForm, rule: ReleaseRule): RuleResult {
  const check = validateReleaseRule(rule);
  if (!check.ok) return check;
  const releases = releasesFromRule(rule, form.stops.length, form.timeZone);
  if (releases.length < form.stops.length) return { ok: false, error: "Couldn't fit every stop into that rule." };
  return {
    ok: true,
    form: { ...form, stops: form.stops.map((stop, i) => ({ ...stop, wall: toWallTime(releases[i], form.timeZone) })) },
  };
}

/** Times typed as "9:00, 15:00" as "HH:mm" strings; null when any of them is not a time. */
export function parseTimes(text: string): string[] | null {
  const parts = text.split(/[,\s]+/).filter(Boolean);
  const times: string[] = [];
  for (const part of parts) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(part);
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
    times.push(`${match[1].padStart(2, "0")}:${match[2]}`);
  }
  return times.length > 0 ? times : null;
}

export interface SchedulePreviewRelease {
  /** "Mon, Nov 23, 9:00 AM" in the form's zone. */
  when: string;
  /** 1-based stop numbers released then. */
  stopNumbers: number[];
}

/**
 * The calendar the creator checks before saving: each release moment in
 * order, with the stops it opens. Stops with no time of their own are listed
 * at the hunt's start. Empty when the start is not a real date and time.
 */
export function schedulePreview(form: ScheduleForm): SchedulePreviewRelease[] {
  const startMs = fromWallTime(form.start, form.timeZone);
  if (startMs === null) return [];
  const byMoment = new Map<number, number[]>();
  form.stops.forEach((stop, index) => {
    const own = stop.wall ? fromWallTime(stop.wall, form.timeZone) : null;
    const at = own === null ? startMs : Math.max(own, startMs);
    byMoment.set(at, [...(byMoment.get(at) ?? []), index + 1]);
  });
  return [...byMoment.entries()]
    .sort(([a], [b]) => a - b)
    .map(([at, stopNumbers]) => ({ when: formatInZone(at, form.timeZone), stopNumbers }));
}
