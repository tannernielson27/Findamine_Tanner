/**
 * Multi-day scheduled hunts (issue #14).
 *
 * A scheduled hunt has one window for everyone (`hunts.starts_at` to
 * `hunts.ends_at`) and releases its stops at set times (`finds.release_at`).
 * A player can join at any point while the window is open and gets every stop
 * released so far. A stop with no release time opens with the hunt.
 *
 * A hunt with no window is a play-anytime hunt: every hunt made before this
 * existed, and still the default. Nothing here applies to those.
 *
 * Every instant is stored in UTC and compared on the server. The time zone
 * (hunt metadata `schedule_timezone`) is only how the creator typed the times
 * and how they are shown back, so a release is the same instant for every
 * player wherever they are.
 *
 * Pure: no I/O and no clock (callers pass `nowMs`), unit tested directly.
 */

export const SCHEDULE_TIMEZONE_KEY = "schedule_timezone";
export const DEFAULT_SCHEDULE_TIMEZONE = "America/Denver";

/** The longest a scheduled hunt may run. */
export const MAX_SCHEDULE_DAYS = 90;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

type Meta = Readonly<Record<string, unknown>> | null | undefined;

export interface HuntWindowSource {
  starts_at?: string | null;
  ends_at?: string | null;
}

/** A hunt's window, as milliseconds since the epoch. */
export interface HuntWindow {
  startsAtMs: number;
  endsAtMs: number;
}

export type HuntPhase = "anytime" | "upcoming" | "open" | "ended";

function parseMs(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** The hunt's window, or null for a play-anytime hunt (or a broken window). */
export function readHuntWindow(hunt: HuntWindowSource | null | undefined): HuntWindow | null {
  const startsAtMs = parseMs(hunt?.starts_at);
  const endsAtMs = parseMs(hunt?.ends_at);
  if (startsAtMs === null || endsAtMs === null || endsAtMs <= startsAtMs) return null;
  return { startsAtMs, endsAtMs };
}

export function isScheduledHunt(hunt: HuntWindowSource | null | undefined): boolean {
  return readHuntWindow(hunt) !== null;
}

/** Where the hunt is in its window. The end instant itself is "ended". */
export function huntPhase(window: HuntWindow | null, nowMs: number): HuntPhase {
  if (!window) return "anytime";
  if (nowMs < window.startsAtMs) return "upcoming";
  return nowMs < window.endsAtMs ? "open" : "ended";
}

/**
 * When a stop opens, in ms. No release time, or one before the hunt's start,
 * means the hunt's start. Null on a play-anytime hunt: its stops are never held.
 */
export function stopReleaseMs(window: HuntWindow | null, releaseAt: string | null | undefined): number | null {
  if (!window) return null;
  const own = parseMs(releaseAt);
  return own === null ? window.startsAtMs : Math.max(own, window.startsAtMs);
}

/** Has the stop opened? Always true on a play-anytime hunt. */
export function isStopReleased(window: HuntWindow | null, releaseAt: string | null | undefined, nowMs: number): boolean {
  const releaseMs = stopReleaseMs(window, releaseAt);
  return releaseMs === null || nowMs >= releaseMs;
}

/** The next release still to come, in ms, or null when everything is out. */
export function nextReleaseMs(
  window: HuntWindow | null,
  releases: ReadonlyArray<string | null | undefined>,
  nowMs: number
): number | null {
  if (!window) return null;
  const upcoming = releases
    .map((r) => stopReleaseMs(window, r))
    .filter((ms): ms is number => ms !== null && ms > nowMs && ms < window.endsAtMs);
  return upcoming.length > 0 ? Math.min(...upcoming) : null;
}

export const HUNT_NOT_OPEN_MESSAGE = "This hunt hasn't started yet.";
export const HUNT_ENDED_MESSAGE = "This hunt has ended.";
export const STOP_NOT_RELEASED_MESSAGE = "This stop hasn't been released yet.";

// ── Time zones ─────────────────────────────────────────────────

/** Is this a time zone the runtime knows (an IANA name such as "America/Denver")? */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The zone the schedule was entered in; the default when none (or a bad one) is stored. */
export function readScheduleTimeZone(metadata: Meta): string {
  const value = metadata?.[SCHEDULE_TIMEZONE_KEY];
  return isTimeZone(value) ? value : DEFAULT_SCHEDULE_TIMEZONE;
}

export interface WallTime {
  /** "YYYY-MM-DD" */
  date: string;
  /** "HH:mm", 24-hour */
  time: string;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

function wallParts(ms: number, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), mo: get("month"), d: get("day"), h: get("hour"), mi: get("minute") };
}

/** The wall-clock date and time of an instant in a zone, for the editor's inputs. */
export function toWallTime(ms: number, timeZone: string): WallTime {
  const p = wallParts(ms, timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${two(p.mo)}-${two(p.d)}`, time: `${two(p.h)}:${two(p.mi)}` };
}

/**
 * The instant (ms) of a wall-clock date and time in a zone, or null when the
 * text is not a real date or time. A time skipped by a clock change (02:30 on
 * the spring-forward night) is moved forward by the size of the gap (03:30);
 * a time that happens twice takes the first.
 */
export function fromWallTime(wall: WallTime, timeZone: string): number | null {
  const date = DATE_RE.exec(wall.date);
  const time = TIME_RE.exec(wall.time);
  if (!date || !time || !isTimeZone(timeZone)) return null;
  const [y, mo, d] = [Number(date[1]), Number(date[2]), Number(date[3])];
  const [h, mi] = [Number(time[1]), Number(time[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Reject dates that roll over (31 February).
  if (new Date(asUtc).getUTCDate() !== d) return null;

  // The zone's offset at a guess, then once more at the corrected instant
  // (the offset can differ across a clock change).
  const offsetAt = (ms: number): number => {
    const p = wallParts(ms, timeZone);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - ms;
  };
  const first = asUtc - offsetAt(asUtc);
  const second = asUtc - offsetAt(first);
  // Two candidates when the offsets disagree: keep the one that reads back as
  // the wall time asked for, earliest first; otherwise (a skipped time) the later.
  const candidates = [...new Set([first, second])].sort((a, b) => a - b);
  const exact = candidates.find((ms) => {
    const p = wallParts(ms, timeZone);
    return p.y === y && p.mo === mo && p.d === d && p.h === h && p.mi === mi;
  });
  return exact ?? candidates[candidates.length - 1];
}

/** "Mon, Nov 23, 9:00 AM" in the given zone. */
export function formatInZone(ms: number, timeZone: string, locale = "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: isTimeZone(timeZone) ? timeZone : DEFAULT_SCHEDULE_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

/** "2 d 4 h", "3 h 12 min", "45 min", "less than a minute": a countdown, coarse on purpose. */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "now";
  const minutes = Math.floor(ms / MINUTE_MS);
  if (minutes < 1) return "less than a minute";
  const days = Math.floor(minutes / (24 * 60));
  const hours = Math.floor((minutes % (24 * 60)) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins > 0 ? `${hours} h ${mins} min` : `${hours} h`;
  return `${mins} min`;
}

// ── The rule that fills in release times ───────────────────────

export interface ReleaseRule {
  /** The first day stops may be released, "YYYY-MM-DD" in the schedule's zone. */
  firstDate: string;
  /** Days of the week releases happen on: 0 Sunday to 6 Saturday. */
  weekdays: ReadonlyArray<number>;
  /** Times of day releases happen at, "HH:mm" in the schedule's zone. */
  times: ReadonlyArray<string>;
  /** How many stops each release opens. */
  perRelease: number;
}

export const MAX_RELEASES_PER_DAY = 6;
export const MAX_STOPS_PER_RELEASE = 20;

export type RuleCheck = { ok: true } | { ok: false; error: string };

export function validateReleaseRule(rule: ReleaseRule): RuleCheck {
  if (!DATE_RE.test(rule.firstDate)) return { ok: false, error: "Choose the first release day." };
  const weekdays = [...new Set(rule.weekdays)];
  if (weekdays.length === 0 || weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
    return { ok: false, error: "Choose at least one day of the week." };
  }
  const times = [...new Set(rule.times)];
  if (times.length === 0 || times.length > MAX_RELEASES_PER_DAY || times.some((t) => !TIME_RE.test(t))) {
    return { ok: false, error: `Give one to ${MAX_RELEASES_PER_DAY} release times a day.` };
  }
  if (!Number.isInteger(rule.perRelease) || rule.perRelease < 1 || rule.perRelease > MAX_STOPS_PER_RELEASE) {
    return { ok: false, error: `Each release can open 1 to ${MAX_STOPS_PER_RELEASE} stops.` };
  }
  return { ok: true };
}

/**
 * Release instants (ms) for `stopCount` stops, in stop order: `perRelease`
 * stops at each of the rule's times, on each of its weekdays, from the first
 * date on. Empty when the rule is not valid. Never mutates.
 */
export function releasesFromRule(rule: ReleaseRule, stopCount: number, timeZone: string): number[] {
  if (!validateReleaseRule(rule).ok || !isTimeZone(timeZone) || stopCount <= 0) return [];
  const weekdays = new Set(rule.weekdays);
  const times = [...new Set(rule.times)].sort();
  const [y, mo, d] = rule.firstDate.split("-").map(Number);
  const releases: number[] = [];
  // Walk calendar days; noon UTC of a calendar date has that date's weekday.
  for (let day = 0; releases.length < stopCount && day < 366 * 2; day++) {
    const noon = new Date(Date.UTC(y, mo - 1, d + day, 12));
    if (!weekdays.has(noon.getUTCDay())) continue;
    const date = noon.toISOString().slice(0, 10);
    for (const time of times) {
      const at = fromWallTime({ date, time }, timeZone);
      if (at === null) continue;
      for (let i = 0; i < rule.perRelease && releases.length < stopCount; i++) releases.push(at);
    }
  }
  return releases;
}

// ── Saving a schedule ──────────────────────────────────────────

export interface ScheduleInput {
  startsAt: string;
  endsAt: string;
  timeZone: string;
  /** One entry per stop; a null release means "at the hunt's start". */
  releases: ReadonlyArray<{ findId: string; releaseAt: string | null }>;
}

export type ScheduleCheck = { ok: true } | { ok: false; error: string };

/**
 * Is this a schedule the hunt can be saved with? The window must run forward
 * and not be absurdly long, the zone must be real, and every live stop must
 * be listed once with a release inside the window.
 */
export function validateSchedule(input: ScheduleInput, findIds: ReadonlyArray<string>): ScheduleCheck {
  const startsAtMs = parseMs(input.startsAt);
  const endsAtMs = parseMs(input.endsAt);
  if (startsAtMs === null) return { ok: false, error: "Choose when the hunt starts." };
  if (endsAtMs === null) return { ok: false, error: "Choose when the hunt ends." };
  if (endsAtMs <= startsAtMs) return { ok: false, error: "The hunt must end after it starts." };
  if (endsAtMs - startsAtMs > MAX_SCHEDULE_DAYS * DAY_MS) {
    return { ok: false, error: `A scheduled hunt can run for at most ${MAX_SCHEDULE_DAYS} days.` };
  }
  if (!isTimeZone(input.timeZone)) return { ok: false, error: "Unknown time zone." };

  const known = new Set(findIds);
  const seen = new Set<string>();
  for (const { findId, releaseAt } of input.releases) {
    if (!known.has(findId)) return { ok: false, error: "The schedule lists a stop that is not in this hunt." };
    if (seen.has(findId)) return { ok: false, error: "The schedule lists a stop twice." };
    seen.add(findId);
    if (releaseAt === null) continue;
    const releaseMs = parseMs(releaseAt);
    if (releaseMs === null) return { ok: false, error: "A release time is not a valid date and time." };
    if (releaseMs < startsAtMs) return { ok: false, error: "A stop can't be released before the hunt starts." };
    if (releaseMs >= endsAtMs) return { ok: false, error: "Every stop must be released before the hunt ends." };
  }
  if (seen.size !== known.size) return { ok: false, error: "Give every stop a release time." };
  return { ok: true };
}

export const SCHEDULE_LOCKED_MESSAGE =
  "The schedule is locked because this hunt has been published or played. Unpublish it (if nobody has played it) or clone it to change the schedule.";

/** Hunt metadata with the schedule's time zone set. Never mutates. */
export function withScheduleTimeZone(metadata: Meta, timeZone: string): Record<string, unknown> {
  return { ...(metadata ?? {}), [SCHEDULE_TIMEZONE_KEY]: timeZone };
}

/** Hunt metadata with the schedule's time zone removed (the hunt is play-anytime again). Never mutates. */
export function withoutScheduleTimeZone(metadata: Meta): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== SCHEDULE_TIMEZONE_KEY));
}
