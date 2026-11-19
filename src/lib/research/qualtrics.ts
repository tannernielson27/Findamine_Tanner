/**
 * Qualtrics surveys for the privacy study. Qualtrics is the study's survey
 * source of record; the app only tells participants when each survey is open
 * and hands them a link that carries their Study ID.
 *
 * Two survey plans, chosen by when a participant enrolled:
 *
 *   four-wave (pilot, 2026-11)  T0, T1, MID, T2. Survey IDs come from
 *     ~/Desktop/Findamine/qualtrics/surveys.json (built by qualtrics/build.mjs).
 *   two-wave (two-week study, from 2026-11-30)  START, END. On only when
 *     QUALTRICS_TWO_WAVE_FROM is set; survey IDs come from the environment
 *     (built by qualtrics/build-twoweek.mjs), so they can be set without a
 *     code change. See twoWaveConfig.
 *
 * The link fields match the builders' URL_FIELDS: sid, src, platform,
 * app_version, and peou (four-wave T2 only).
 *
 * Pure (no I/O), so the schedule rules are unit tested directly.
 */

export const QUALTRICS_HOST = "https://byu.az1.qualtrics.com";

export type QualtricsWave = "T0" | "T1" | "MID" | "T2" | "START" | "END";

export const FOUR_WAVE_PLAN: readonly QualtricsWave[] = ["T0", "T1", "MID", "T2"];
export const TWO_WAVE_PLAN: readonly QualtricsWave[] = ["START", "END"];

/** Every wave of either plan (export columns, input validation). */
export const QUALTRICS_WAVES: readonly QualtricsWave[] = [...FOUR_WAVE_PLAN, ...TWO_WAVE_PLAN];

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Week-2 check-in, for the mid_survey half only. */
export const MID_OPEN_DAY = 14;

/**
 * End-of-study survey. UNCONFIRMED (2026-11-14): the IRB draft says day 42,
 * the RA's plan says 4 weeks. Defaults to 28; set QUALTRICS_T2_DAY to change
 * it without a code edit. Confirm with Dr. Keith and keep the IRB in step.
 */
export const DEFAULT_T2_OPEN_DAY = 28;

type Env = Record<string, string | undefined>;

export function t2OpenDay(env: Env = process.env): number {
  const raw = Number(env.QUALTRICS_T2_DAY);
  return Number.isInteger(raw) && raw > 0 && raw <= 120 ? raw : DEFAULT_T2_OPEN_DAY;
}

// ── Two-wave plan ──────────────────────────────────────────────

/**
 * START asks what a participant expects of the settings they have just seen,
 * so it opens at their first look at the privacy page (the welcome tour
 * counts). Someone who never opens that page gets it this long after enrolling.
 */
export const START_FALLBACK_HOURS = 24;

/** END with no fixed opening time: this many days after enrolling. */
export const END_FALLBACK_DAY = 10;

/** END never opens sooner than this after enrolling, even for a late joiner. */
export const END_MIN_HOURS_AFTER_ENROLLING = 24;

export interface TwoWaveConfig {
  /** Enrollments at or after this instant (ms) are on the two-wave plan. */
  fromMs: number;
  startSurveyId: string | null;
  endSurveyId: string | null;
  /** The instant (ms) END opens for the whole cohort; null = END_FALLBACK_DAY after enrolling. */
  endOpensAtMs: number | null;
}

const SURVEY_ID_RE = /^SV_[A-Za-z0-9]{8,24}$/;

function instant(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function surveyId(value: string | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return SURVEY_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * The two-wave plan's settings, or null when it is off (nobody is on it).
 *
 *   QUALTRICS_TWO_WAVE_FROM    instant with an offset, e.g. 2026-11-30T00:00:00-07:00.
 *                              Required: without it the plan is off.
 *   QUALTRICS_START_SURVEY_ID  SV_… of the Start survey
 *   QUALTRICS_END_SURVEY_ID    SV_… of the End survey
 *   QUALTRICS_END_OPENS_AT     instant END opens for everyone (optional)
 *
 * A wave whose survey ID is missing or malformed stays closed rather than
 * opening with a broken link.
 */
export function twoWaveConfig(env: Env = process.env): TwoWaveConfig | null {
  const fromMs = instant(env.QUALTRICS_TWO_WAVE_FROM);
  if (fromMs === null) return null;
  return {
    fromMs,
    startSurveyId: surveyId(env.QUALTRICS_START_SURVEY_ID),
    endSurveyId: surveyId(env.QUALTRICS_END_SURVEY_ID),
    endOpensAtMs: instant(env.QUALTRICS_END_OPENS_AT),
  };
}

/** The waves a participant gets, by when they enrolled. */
export function surveyPlanFor(enrolledAt: string, config: TwoWaveConfig | null): readonly QualtricsWave[] {
  const enrolled = Date.parse(enrolledAt);
  return config && Number.isFinite(enrolled) && enrolled >= config.fromMs ? TWO_WAVE_PLAN : FOUR_WAVE_PLAN;
}

interface WaveDefinition {
  /** Empty for two-wave surveys: their IDs come from twoWaveConfig. */
  surveyId: string;
  /** Neutral, participant-facing title (IRB: no mention of privacy as the focus). */
  title: string;
  minutes: number;
}

export const WAVE_DEFINITIONS: Readonly<Record<QualtricsWave, WaveDefinition>> = {
  T0: { surveyId: "SV_1S8rDGSfWLNvAAC", title: "Start-of-study survey", minutes: 4 },
  T1: { surveyId: "SV_3gDCnJc7b5BRa50", title: "First check-in", minutes: 3 },
  MID: { surveyId: "SV_2ueC01ALd6ulahE", title: "Week 2 check-in", minutes: 1 },
  T2: { surveyId: "SV_54maen9G7fb4g3Y", title: "End-of-study survey", minutes: 4 },
  START: { surveyId: "", title: "Start-of-study survey", minutes: 8 },
  END: { surveyId: "", title: "End-of-study survey", minutes: 9 },
};

/** The Qualtrics survey behind a wave, or null when it has not been set up. */
export function surveyIdFor(wave: QualtricsWave, config: TwoWaveConfig | null): string | null {
  if (wave === "START") return config?.startSurveyId ?? null;
  if (wave === "END") return config?.endSurveyId ?? null;
  return WAVE_DEFINITIONS[wave].surveyId;
}

export interface ParticipantSurveyState {
  participantCode: string;
  enrolledAt: string;
  midSurvey: boolean | null;
  peouBlock: boolean | null;
  /** First time this participant saw the privacy settings (any privacy_view). */
  firstPrivacyViewAt: string | null;
  /** Waves the participant marked as finished in the app. */
  markedDone: ReadonlySet<QualtricsWave>;
}

export type WaveStatus = "not_yet" | "open" | "done" | "not_assigned";

export interface WaveView {
  wave: QualtricsWave;
  title: string;
  minutes: number;
  status: WaveStatus;
  /** When the wave opens/opened; null when it depends on an event not yet seen. */
  opensAt: string | null;
  /** Link with sid/src/peou; the client adds platform and app_version. */
  url: string | null;
}

/**
 * When a wave opens for this participant. Null when it is not known yet, will
 * never open, or the wave is not part of the participant's plan.
 */
export function waveOpensAt(
  wave: QualtricsWave,
  state: Pick<ParticipantSurveyState, "enrolledAt" | "midSurvey" | "firstPrivacyViewAt">,
  t2Day: number = t2OpenDay(),
  config: TwoWaveConfig | null = twoWaveConfig()
): string | null {
  const enrolled = new Date(state.enrolledAt).getTime();
  if (!Number.isFinite(enrolled)) return null;
  if (!surveyPlanFor(state.enrolledAt, config).includes(wave)) return null;
  switch (wave) {
    case "T0":
      return new Date(enrolled).toISOString();
    case "T1":
      return state.firstPrivacyViewAt;
    case "MID":
      return state.midSurvey ? new Date(enrolled + MID_OPEN_DAY * DAY_MS).toISOString() : null;
    case "T2":
      return new Date(enrolled + t2Day * DAY_MS).toISOString();
    case "START": {
      const fallback = enrolled + START_FALLBACK_HOURS * HOUR_MS;
      const viewed = state.firstPrivacyViewAt ? Date.parse(state.firstPrivacyViewAt) : Number.NaN;
      return new Date(Number.isFinite(viewed) ? Math.min(viewed, fallback) : fallback).toISOString();
    }
    case "END": {
      const scheduled = config?.endOpensAtMs ?? enrolled + END_FALLBACK_DAY * DAY_MS;
      return new Date(Math.max(scheduled, enrolled + END_MIN_HOURS_AFTER_ENROLLING * HOUR_MS)).toISOString();
    }
  }
}

/** Qualtrics link for one wave, carrying the Study ID. Null when the wave's survey is not set up. */
export function buildSurveyUrl(
  wave: QualtricsWave,
  participantCode: string,
  opts: { peouBlock?: boolean | null; platform?: string; appVersion?: string | null } = {},
  config: TwoWaveConfig | null = twoWaveConfig()
): string | null {
  const id = surveyIdFor(wave, config);
  if (!id) return null;
  const params = new URLSearchParams({ sid: participantCode, src: "app" });
  if (opts.platform) params.set("platform", opts.platform);
  if (opts.appVersion) params.set("app_version", opts.appVersion);
  if (wave === "T2" && opts.peouBlock) params.set("peou", "1");
  return `${QUALTRICS_HOST}/jfe/form/${id}?${params.toString()}`;
}

/** Every wave of the participant's plan, with its status at `now`. */
export function surveyWaves(
  state: ParticipantSurveyState,
  now: Date = new Date(),
  t2Day: number = t2OpenDay(),
  config: TwoWaveConfig | null = twoWaveConfig()
): WaveView[] {
  return surveyPlanFor(state.enrolledAt, config).map((wave) => {
    const def = WAVE_DEFINITIONS[wave];
    const base = { wave, title: def.title, minutes: def.minutes };
    if (wave === "MID" && state.midSurvey !== true) {
      return { ...base, status: "not_assigned" as const, opensAt: null, url: null };
    }
    const opensAt = waveOpensAt(wave, state, t2Day, config);
    if (state.markedDone.has(wave)) {
      return { ...base, status: "done" as const, opensAt, url: null };
    }
    const due = opensAt !== null && new Date(opensAt).getTime() <= now.getTime();
    // A wave is only open when there is a survey to send the participant to.
    const url = due ? buildSurveyUrl(wave, state.participantCode, { peouBlock: state.peouBlock }, config) : null;
    return { ...base, status: url ? ("open" as const) : ("not_yet" as const), opensAt, url };
  });
}

export function isQualtricsWave(value: unknown): value is QualtricsWave {
  return typeof value === "string" && (QUALTRICS_WAVES as readonly string[]).includes(value);
}
