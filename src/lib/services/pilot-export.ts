/**
 * Pilot export additions (2026-11-14), kept beside research-export.ts:
 *  - Qualtrics columns on the participant-level export (subset flags, when
 *    each wave opened, first launch, marked finished)
 *  - dataset=qualtrics  : one row per launch / "I finished" tap
 *  - dataset=app_events : screen views, app foreground/background, client
 *    errors and forfeit-notice events, with the session/platform/version envelope
 *  - dataset=withdrawals: Study ID + dates only (no data from withdrawn people)
 *
 * Every dataset is keyed by the stable Study ID (study_enrollments.participant_code).
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchAllByIds, fetchAllRows } from "@/lib/utils/paginate";
import { QUALTRICS_WAVES, t2OpenDay, waveOpensAt } from "@/lib/research/qualtrics";
import { loadSurveyStates, type EnrollmentRow, type LaunchRow } from "@/lib/services/qualtrics-surveys";
import { serialize, type ExportConfig } from "@/lib/services/research-export";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Behavioral event types exported in dataset=app_events. Their payloads carry
 * screen templates (ids replaced), app state, redacted error text, or
 * forfeit-notice points; never another person's id.
 */
export const APP_EVENT_TYPES = [
  "screen_view",
  "app_state",
  "client_error",
  "forfeit_notice_eligible",
  "forfeit_notice_viewed",
] as const;

const DAY_MS = 86_400_000;

/** Days from `from` to `to` (fixed decimals), or "" if either is missing / negative. Pure. */
export function daysBetween(from: string | null | undefined, to: string | null | undefined, dp = 4): string {
  if (!from || !to) return "";
  const d = (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
  return Number.isFinite(d) && d >= 0 ? d.toFixed(dp) : "";
}

export function flag(value: boolean | null | undefined): string {
  return value === true ? "1" : value === false ? "0" : "";
}

/** Active enrollments with everything the pilot columns need. */
export async function loadActiveEnrollments(supabase: ServiceClient, studyId: string): Promise<EnrollmentRow[]> {
  return fetchAllRows<EnrollmentRow>((from, to) =>
    supabase
      .from("study_enrollments")
      .select("study_id, user_id, participant_code, enrolled_at, mid_survey, peou_block")
      .eq("study_id", studyId)
      .is("withdrawn_at", null)
      .order("participant_code", { ascending: true })
      .order("user_id", { ascending: true })
      .range(from, to)
  );
}

export const QUALTRICS_COLUMN_HEADERS: readonly string[] = [
  "mid_survey",
  "peou_block",
  ...QUALTRICS_WAVES.flatMap((w) => {
    const k = w.toLowerCase();
    return [`q_${k}_opens_at`, `q_${k}_first_launch_at`, `q_${k}_marked_done_at`];
  }),
];

/** Pure: the Qualtrics columns for one participant. */
export function qualtricsValues(
  enrollment: EnrollmentRow,
  firstPrivacyViewAt: string | null,
  launches: readonly LaunchRow[],
  t2Day: number
): string[] {
  const values = [flag(enrollment.mid_survey), flag(enrollment.peou_block)];
  for (const wave of QUALTRICS_WAVES) {
    const opens = waveOpensAt(
      wave,
      { enrolledAt: enrollment.enrolled_at, midSurvey: enrollment.mid_survey, firstPrivacyViewAt },
      t2Day
    );
    const mine = launches.filter((l) => l.wave === wave);
    const firstLaunch = mine.find((l) => l.action === "launched")?.created_at ?? "";
    const done = mine.find((l) => l.action === "marked_done")?.created_at ?? "";
    values.push(opens ?? "", firstLaunch, done);
  }
  return values;
}

/**
 * Qualtrics column block for the participant-level export: headers plus a
 * per-user value function (blank cells for anyone without an enrollment row).
 */
export async function loadQualtricsColumns(
  supabase: ServiceClient,
  studyId: string
): Promise<{ headers: readonly string[]; valuesFor: (userId: string) => string[] }> {
  const enrollments = await loadActiveEnrollments(supabase, studyId);
  const { states, launches } = await loadSurveyStates(supabase, enrollments);
  const byUser = new Map(enrollments.map((e) => [e.user_id, e]));
  const launchesByUser = new Map<string, LaunchRow[]>();
  for (const l of launches) {
    if (!launchesByUser.has(l.user_id)) launchesByUser.set(l.user_id, []);
    launchesByUser.get(l.user_id)!.push(l);
  }
  const t2Day = t2OpenDay();
  const blank = QUALTRICS_COLUMN_HEADERS.map(() => "");
  return {
    headers: QUALTRICS_COLUMN_HEADERS,
    valuesFor: (userId) => {
      const e = byUser.get(userId);
      if (!e) return blank;
      return qualtricsValues(e, states.get(userId)?.firstPrivacyViewAt ?? null, launchesByUser.get(userId) ?? [], t2Day);
    },
  };
}

/** dataset=qualtrics: every launch / "I finished" tap, long format. */
export async function generateQualtricsExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();
  const enrollments = await loadActiveEnrollments(supabase, config.studyId);
  if (enrollments.length === 0) return "";
  const { launches } = await loadSurveyStates(supabase, enrollments);
  const byUser = new Map(enrollments.map((e) => [e.user_id, e]));
  const headers = ["participant_id", "wave", "action", "event_at", "days_since_enrollment"];
  const rows = launches
    .filter((l) => byUser.has(l.user_id))
    .map((l) => {
      const e = byUser.get(l.user_id)!;
      return [e.participant_code, l.wave, l.action, l.created_at, daysBetween(e.enrolled_at, l.created_at)];
    });
  if (rows.length === 0) return "";
  return serialize(headers, rows, config.format);
}

/** dataset=app_events: client telemetry + forfeit-notice events, long format. */
export async function generateAppEventsExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();
  const enrollments = await loadActiveEnrollments(supabase, config.studyId);
  if (enrollments.length === 0) return "";
  const byUser = new Map(enrollments.map((e) => [e.user_id, e]));

  const events = await fetchAllByIds<{
    user_id: string;
    event_type: string;
    event_name: string | null;
    session_id: string | null;
    platform: string | null;
    app_version: string | null;
    payload: unknown;
    created_at: string;
  }>([...byUser.keys()], (ids, from, to) =>
    supabase
      .from("behavioral_events")
      .select("user_id, event_type, event_name, session_id, platform, app_version, payload, created_at")
      .in("user_id", ids)
      .in("event_type", [...APP_EVENT_TYPES])
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  const headers = [
    "participant_id",
    "event_at",
    "days_since_enrollment",
    "event_type",
    "event_name",
    "session_id",
    "platform",
    "app_version",
    "payload_json",
  ];
  const rows: string[][] = [];
  for (const ev of events) {
    const e = byUser.get(ev.user_id);
    // Only events from the enrollment on; earlier ones predate consent.
    if (!e || Date.parse(ev.created_at) < Date.parse(e.enrolled_at)) continue;
    rows.push([
      e.participant_code,
      ev.created_at,
      daysBetween(e.enrolled_at, ev.created_at),
      ev.event_type,
      ev.event_name ?? "",
      ev.session_id ?? "",
      ev.platform ?? "",
      ev.app_version ?? "",
      JSON.stringify(ev.payload ?? {}),
    ]);
  }
  if (rows.length === 0) return "";
  return serialize(headers, rows, config.format);
}

/**
 * dataset=withdrawals: who withdrew and when, by Study ID only. Withdrawn
 * participants' data is left out of every other dataset; this list lets the
 * matching Qualtrics responses be removed too.
 */
export async function generateWithdrawalsExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();
  const rows = await fetchAllRows<{ participant_code: string; enrolled_at: string; withdrawn_at: string }>(
    (from, to) =>
      supabase
        .from("study_enrollments")
        .select("participant_code, enrolled_at, withdrawn_at")
        .eq("study_id", config.studyId)
        .not("withdrawn_at", "is", null)
        .order("participant_code", { ascending: true })
        .range(from, to)
  );
  if (rows.length === 0) return "";
  return serialize(
    ["participant_id", "enrolled_at", "withdrawn_at", "days_enrolled"],
    rows.map((r) => [r.participant_code, r.enrolled_at, r.withdrawn_at, daysBetween(r.enrolled_at, r.withdrawn_at, 2)]),
    config.format
  );
}
