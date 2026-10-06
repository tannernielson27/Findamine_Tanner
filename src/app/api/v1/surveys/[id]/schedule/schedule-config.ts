/**
 * Survey delivery schedule — pure validation and description.
 *
 * Side-effect free (no Supabase, no server imports) so the route, the admin UI
 * and the tests share one definition of "a schedule the delivery service will
 * actually act on". The delivery service (src/lib/services/survey-delivery.ts,
 * survey-triggers.ts) only ever creates deliveries from:
 *
 *   time   { timepoint, offset_days, expires_days }            cron + enrollment
 *   event  { timepoint, event, expires_days }                  POST /surveys/trigger
 *
 * and a survey may pair its event row with a second `time` row flagged
 * `fallback: true` (T1 does, migration 054). `completion` and `manual` pass the
 * table's CHECK constraint but nothing delivers them, so they are rejected here.
 *
 * One logical schedule per survey = one primary row (+ an optional fallback row).
 */

import { ALLOWED_TRIGGER_EVENTS } from "@/lib/services/survey-triggers";

export const DELIVERABLE_TRIGGER_TYPES = ["time", "event"] as const;
export type DeliverableTriggerType = (typeof DELIVERABLE_TRIGGER_TYPES)[number];

export const MAX_OFFSET_DAYS = 365;
export const MAX_EXPIRES_DAYS = 90;
/** Timepoint labels become export column names (status_T1, …), so keep them plain. */
export const TIMEPOINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/;
/** Timepoints whose pending delivery blocks Save on the privacy settings page. */
export const GATING_TIMEPOINTS: readonly string[] = ["T1", "T3"];

export interface TimeScheduleInput {
  trigger_type: "time";
  active: boolean;
  trigger_config: { timepoint: string; offset_days: number; expires_days: number };
}

export interface EventScheduleInput {
  trigger_type: "event";
  active: boolean;
  trigger_config: {
    timepoint: string;
    event: string;
    expires_days: number;
    /** Also send N days after enrollment to participants who never fire the event. */
    fallback: { offset_days: number } | null;
  };
}

export type ScheduleInput = TimeScheduleInput | EventScheduleInput;

/** A survey_schedules row as stored (only the columns the table has). */
export interface StoredScheduleRow {
  id?: string;
  survey_id: string;
  trigger_type: string;
  trigger_config: unknown;
  active: boolean | null;
}

export class ScheduleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduleValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string) {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    throw new ScheduleValidationError(
      `Unknown ${where} field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}. Allowed: ${allowed.join(", ")}.`
    );
  }
}

function wholeDays(value: unknown, name: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ScheduleValidationError(`${name} must be a whole number of days from ${min} to ${max}.`);
  }
  return value;
}

function timepointOf(value: unknown): string {
  const tp = typeof value === "string" ? value.trim() : "";
  if (!TIMEPOINT_PATTERN.test(tp)) {
    throw new ScheduleValidationError(
      "timepoint is required: a short label such as T1, T2 or T3 (letters, digits, - and _, at most 16 characters)."
    );
  }
  return tp;
}

/**
 * Validate a PUT body into a schedule the delivery service consumes. Throws
 * ScheduleValidationError with an admin-readable message. `confirm` is a
 * request flag, not part of the schedule, and is ignored here.
 */
export function parseScheduleInput(body: unknown): ScheduleInput {
  if (!isRecord(body)) throw new ScheduleValidationError("Request body must be a JSON object.");
  rejectUnknownKeys(body, ["trigger_type", "trigger_config", "active", "confirm"], "schedule");

  const type = body.trigger_type;
  if (type === "completion" || type === "manual") {
    throw new ScheduleValidationError(
      `trigger_type "${type}" is never delivered: the delivery service only sends "time" and "event" schedules.`
    );
  }
  if (type !== "time" && type !== "event") {
    throw new ScheduleValidationError('trigger_type must be "time" or "event".');
  }

  if (body.active !== undefined && typeof body.active !== "boolean") {
    throw new ScheduleValidationError("active must be true or false.");
  }
  const active = body.active !== false;

  const cfg = body.trigger_config;
  if (!isRecord(cfg)) throw new ScheduleValidationError("trigger_config must be an object.");

  if (type === "time") {
    rejectUnknownKeys(cfg, ["timepoint", "offset_days", "expires_days"], "time trigger_config");
    return {
      trigger_type: "time",
      active,
      trigger_config: {
        timepoint: timepointOf(cfg.timepoint),
        offset_days: wholeDays(cfg.offset_days, "offset_days", 0, MAX_OFFSET_DAYS),
        expires_days: wholeDays(cfg.expires_days, "expires_days", 1, MAX_EXPIRES_DAYS),
      },
    };
  }

  rejectUnknownKeys(cfg, ["timepoint", "event", "expires_days", "fallback"], "event trigger_config");
  if (typeof cfg.event !== "string" || !(ALLOWED_TRIGGER_EVENTS as readonly string[]).includes(cfg.event)) {
    throw new ScheduleValidationError(
      `event must be one of: ${ALLOWED_TRIGGER_EVENTS.join(", ")}. No other event is ever reported by the app.`
    );
  }
  let fallback: { offset_days: number } | null = null;
  if (cfg.fallback !== undefined && cfg.fallback !== null) {
    if (!isRecord(cfg.fallback)) {
      throw new ScheduleValidationError("fallback must be { offset_days } or null.");
    }
    rejectUnknownKeys(cfg.fallback, ["offset_days"], "fallback");
    fallback = { offset_days: wholeDays(cfg.fallback.offset_days, "fallback.offset_days", 0, MAX_OFFSET_DAYS) };
  }
  return {
    trigger_type: "event",
    active,
    trigger_config: {
      timepoint: timepointOf(cfg.timepoint),
      event: cfg.event,
      expires_days: wholeDays(cfg.expires_days, "expires_days", 1, MAX_EXPIRES_DAYS),
      fallback,
    },
  };
}

/** The survey_schedules rows that store a logical schedule (primary first). */
export function toScheduleRows(surveyId: string, input: ScheduleInput): StoredScheduleRow[] {
  const cfg = input.trigger_config;
  if (input.trigger_type === "time") {
    return [
      {
        survey_id: surveyId,
        trigger_type: "time",
        trigger_config: { timepoint: cfg.timepoint, offset_days: input.trigger_config.offset_days, expires_days: cfg.expires_days },
        active: input.active,
      },
    ];
  }
  const rows: StoredScheduleRow[] = [
    {
      survey_id: surveyId,
      trigger_type: "event",
      trigger_config: { timepoint: cfg.timepoint, event: input.trigger_config.event, expires_days: cfg.expires_days },
      active: input.active,
    },
  ];
  const fallback = input.trigger_config.fallback;
  if (fallback) {
    rows.push({
      survey_id: surveyId,
      trigger_type: "time",
      trigger_config: {
        timepoint: cfg.timepoint,
        offset_days: fallback.offset_days,
        expires_days: cfg.expires_days,
        fallback: true,
      },
      active: input.active,
    });
  }
  return rows;
}

export interface DescribedSchedule {
  /** The logical schedule, or null when no stored row is one the delivery service sends. */
  schedule: ScheduleInput | null;
  /** Stored rows this editor does not represent (legacy types, duplicates). Replaced on save. */
  unmanaged_rows: number;
}

type LooseRow = Pick<StoredScheduleRow, "trigger_type" | "trigger_config" | "active">;

const cfgOf = (row: LooseRow): Record<string, unknown> => (isRecord(row.trigger_config) ? row.trigger_config : {});
const num = (v: unknown, fallback: number): number => (typeof v === "number" ? v : fallback);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Read stored rows back into the logical schedule. Mirrors normalizeSchedules'
 * defaults (offset 0, expiry 7 days) so what is shown is what is delivered.
 */
export function describeScheduleRows(rows: readonly LooseRow[]): DescribedSchedule {
  const eventRow = rows.find((r) => r.trigger_type === "event" && typeof cfgOf(r).event === "string");
  const timeRows = rows.filter((r) => r.trigger_type === "time");

  if (eventRow) {
    const cfg = cfgOf(eventRow);
    const fallbackRow = timeRows.find((r) => cfgOf(r).fallback === true) ?? timeRows[0];
    return {
      schedule: {
        trigger_type: "event",
        active: eventRow.active !== false,
        trigger_config: {
          timepoint: str(cfg.timepoint),
          event: str(cfg.event),
          expires_days: num(cfg.expires_days, 7),
          fallback: fallbackRow ? { offset_days: num(cfgOf(fallbackRow).offset_days, 0) } : null,
        },
      },
      unmanaged_rows: rows.length - 1 - (fallbackRow ? 1 : 0),
    };
  }

  const timeRow = timeRows[0];
  if (!timeRow) return { schedule: null, unmanaged_rows: rows.length };
  const cfg = cfgOf(timeRow);
  return {
    schedule: {
      trigger_type: "time",
      active: timeRow.active !== false,
      trigger_config: {
        timepoint: str(cfg.timepoint),
        offset_days: num(cfg.offset_days, 0),
        expires_days: num(cfg.expires_days, 7),
      },
    },
    unmanaged_rows: rows.length - 1,
  };
}

const days = (n: number): string => `${n} day${n === 1 ? "" : "s"}`;
const afterEnrollment = (n: number): string => (n === 0 ? "at enrollment" : `${days(n)} after enrollment`);

const EVENT_PHRASES: Record<string, string> = {
  privacy_view: "the first time a participant opens their privacy settings",
};

/** Plain-language summary, e.g. "Sent 14 days after enrollment, closes after 7 days". */
export function summarizeSchedule(schedule: ScheduleInput): string {
  const closes = `closes after ${days(schedule.trigger_config.expires_days)}`;
  if (schedule.trigger_type === "time") {
    return `Sent ${afterEnrollment(schedule.trigger_config.offset_days)}, ${closes}`;
  }
  const { event, fallback } = schedule.trigger_config;
  const when = EVENT_PHRASES[event] ?? `when "${event}" happens`;
  const or = fallback ? `, or ${afterEnrollment(fallback.offset_days)} if that never happens` : "";
  return `Sent ${when}${or}; ${closes}`;
}

/** True when two logical schedules would store identical rows. */
export function sameSchedule(a: ScheduleInput | null, b: ScheduleInput | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(toScheduleRows("", a)) === JSON.stringify(toScheduleRows("", b));
}

export const sameTimepoint = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
