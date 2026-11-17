/**
 * Server side of the Qualtrics survey schedule (pilot 2026-11): loads one
 * participant's survey state, records launches, and posts a bell notification
 * when a wave opens. The schedule rules themselves are pure, in
 * lib/research/qualtrics.ts.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchAllByIds, fetchAllRows } from "@/lib/utils/paginate";
import {
  surveyWaves,
  isQualtricsWave,
  type QualtricsWave,
  type ParticipantSurveyState,
  type WaveView,
} from "@/lib/research/qualtrics";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

export const STUDY_SURVEY_NOTIFICATION_TYPE = "study_survey";

export interface EnrollmentRow {
  study_id: string;
  user_id: string;
  participant_code: string;
  enrolled_at: string;
  mid_survey: boolean | null;
  peou_block: boolean | null;
}

export interface ParticipantSurveys {
  studyId: string;
  participantCode: string;
  waves: WaveView[];
}

const ENROLLMENT_COLUMNS = "study_id, user_id, participant_code, enrolled_at, mid_survey, peou_block";

/** Ids of studies currently running (status active). */
async function activeStudyIds(supabase: ServiceClient): Promise<string[]> {
  const { data, error } = await supabase.from("treatment_studies").select("id").eq("status", "active");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => r.id as string);
}

/** The participant's active (non-withdrawn) enrollment in an active study, if any. */
export async function getActiveEnrollment(
  supabase: ServiceClient,
  userId: string
): Promise<EnrollmentRow | null> {
  const studyIds = await activeStudyIds(supabase);
  if (studyIds.length === 0) return null;
  const { data, error } = await supabase
    .from("study_enrollments")
    .select(ENROLLMENT_COLUMNS)
    .eq("user_id", userId)
    .in("study_id", studyIds)
    .is("withdrawn_at", null)
    .order("enrolled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as EnrollmentRow | null) ?? null;
}

function groupByUser<T extends { user_id: string }>(rows: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    if (!out.has(r.user_id)) out.set(r.user_id, []);
    out.get(r.user_id)!.push(r);
  }
  return out;
}

export interface LaunchRow {
  user_id: string;
  wave: string;
  action: string;
  created_at: string;
}

/**
 * Survey state for many enrollments in three paginated reads (not three per
 * participant), so the daily cron and the export stay inside their time limit
 * at full cohort size. The first privacy_view counts any reason, including
 * the welcome tour: the tour shows the settings page too.
 */
export async function loadSurveyStates(
  supabase: ServiceClient,
  enrollments: readonly EnrollmentRow[]
): Promise<{ states: Map<string, ParticipantSurveyState>; launches: LaunchRow[] }> {
  const userIds = enrollments.map((e) => e.user_id);
  const studyIds = [...new Set(enrollments.map((e) => e.study_id))];
  const [views, launches] = await Promise.all([
    fetchAllByIds<{ user_id: string; created_at: string }>(userIds, (ids, from, to) =>
      supabase
        .from("privacy_events")
        .select("user_id, created_at")
        .in("user_id", ids)
        .eq("event_type", "privacy_view")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllByIds<LaunchRow>(userIds, (ids, from, to) =>
      supabase
        .from("qualtrics_launches")
        .select("user_id, wave, action, created_at")
        .in("user_id", ids)
        .in("study_id", studyIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);

  const viewsByUser = groupByUser(views);
  const doneByUser = new Map<string, Set<QualtricsWave>>();
  for (const l of launches) {
    if (l.action !== "marked_done" || !isQualtricsWave(l.wave)) continue;
    if (!doneByUser.has(l.user_id)) doneByUser.set(l.user_id, new Set());
    doneByUser.get(l.user_id)!.add(l.wave);
  }

  const states = new Map<string, ParticipantSurveyState>();
  for (const e of enrollments) {
    // Ascending, so the first one at/after enrollment is the first exposure.
    const enrolledMs = Date.parse(e.enrolled_at);
    const firstView = (viewsByUser.get(e.user_id) ?? []).find((v) => Date.parse(v.created_at) >= enrolledMs);
    const done = doneByUser.get(e.user_id) ?? new Set<QualtricsWave>();
    states.set(e.user_id, {
      participantCode: e.participant_code,
      enrolledAt: e.enrolled_at,
      midSurvey: e.mid_survey,
      peouBlock: e.peou_block,
      firstPrivacyViewAt: firstView?.created_at ?? null,
      markedDone: done,
    });
  }
  return { states, launches };
}

/** Survey list for the participant's study page; null for non-participants. */
/**
 * True while any study is running. The Settings link to /debrief is hidden
 * then: the debrief describes the conditions and would bias participants.
 */
export async function isStudyRunning(): Promise<boolean> {
  const supabase = await createSupabaseServiceClient();
  return (await activeStudyIds(supabase)).length > 0;
}

export async function getParticipantSurveys(userId: string): Promise<ParticipantSurveys | null> {
  const supabase = await createSupabaseServiceClient();
  const enrollment = await getActiveEnrollment(supabase, userId);
  if (!enrollment) return null;
  const { states } = await loadSurveyStates(supabase, [enrollment]);
  const state = states.get(userId);
  if (!state) return null;
  return {
    studyId: enrollment.study_id,
    participantCode: enrollment.participant_code,
    waves: surveyWaves(state),
  };
}

export async function recordQualtricsAction(opts: {
  studyId: string;
  userId: string;
  wave: QualtricsWave;
  action: "launched" | "marked_done";
  platform: string | null;
  appVersion: string | null;
}): Promise<void> {
  const supabase = await createSupabaseServiceClient();
  const { error } = await supabase.from("qualtrics_launches").insert({
    study_id: opts.studyId,
    user_id: opts.userId,
    wave: opts.wave,
    action: opts.action,
    platform: opts.platform,
    app_version: opts.appVersion,
  });
  if (error) throw new Error(error.message);
}

/** Bell text for a wave that just opened. Neutral wording (no privacy framing). */
export function openWaveNotification(wave: WaveView): { title: string; body: string } {
  return {
    title: `${wave.title} is ready`,
    body: `It takes about ${wave.minutes} minute${wave.minutes === 1 ? "" : "s"}. Tap to start it.`,
  };
}

/**
 * Daily: post one bell notification per open, unfinished wave per active
 * participant, once per wave (deduped on title). Selects recipients only by
 * schedule, never by condition. Returns how many were posted.
 */
export async function notifyOpenSurveyWaves(now: Date = new Date()): Promise<number> {
  const supabase = await createSupabaseServiceClient();
  const studyIds = await activeStudyIds(supabase);
  if (studyIds.length === 0) return 0;
  const enrollments = await fetchAllRows<EnrollmentRow>((from, to) =>
    supabase
      .from("study_enrollments")
      .select(ENROLLMENT_COLUMNS)
      .in("study_id", studyIds)
      .is("withdrawn_at", null)
      .order("user_id", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  if (enrollments.length === 0) return 0;

  const { states } = await loadSurveyStates(supabase, enrollments);
  const sent = await fetchAllByIds<{ user_id: string; title: string }>(
    enrollments.map((e) => e.user_id),
    (ids, from, to) =>
      supabase
        .from("notifications")
        .select("user_id, title")
        .in("user_id", ids)
        .eq("type", STUDY_SURVEY_NOTIFICATION_TYPE)
        .order("user_id", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
  );
  const sentKeys = new Set(sent.map((n) => `${n.user_id}::${n.title}`));

  const rows: { user_id: string; type: string; title: string; body: string }[] = [];
  for (const e of enrollments) {
    const state = states.get(e.user_id);
    if (!state) continue;
    for (const wave of surveyWaves(state, now)) {
      if (wave.status !== "open") continue;
      const note = openWaveNotification(wave);
      if (sentKeys.has(`${e.user_id}::${note.title}`)) continue;
      rows.push({ user_id: e.user_id, type: STUDY_SURVEY_NOTIFICATION_TYPE, ...note });
    }
  }

  let posted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("notifications").insert(chunk);
    if (error) throw new Error(`study survey notifications: ${error.message}`);
    posted += chunk.length;
  }
  return posted;
}
