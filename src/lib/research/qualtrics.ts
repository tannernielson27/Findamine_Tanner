/**
 * Qualtrics surveys for the privacy pilot (2026-11). Qualtrics is the study's
 * survey source of record; the app only tells participants when each survey is
 * open and hands them a link that carries their Study ID.
 *
 * Survey IDs come from ~/Desktop/Findamine/qualtrics/surveys.json (built by
 * qualtrics/build.mjs). The link fields match build.mjs URL_FIELDS:
 * sid, src, platform, app_version, peou.
 *
 * Pure (no I/O), so the schedule rules are unit tested directly.
 */

export const QUALTRICS_HOST = "https://byu.az1.qualtrics.com";

export type QualtricsWave = "T0" | "T1" | "MID" | "T2";

export const QUALTRICS_WAVES: readonly QualtricsWave[] = ["T0", "T1", "MID", "T2"];

const DAY_MS = 86_400_000;

/** Week-2 check-in, for the mid_survey half only. */
export const MID_OPEN_DAY = 14;

/**
 * End-of-study survey. UNCONFIRMED (2026-11-14): the IRB draft says day 42,
 * the RA's plan says 4 weeks. Defaults to 28; set QUALTRICS_T2_DAY to change
 * it without a code edit. Confirm with Dr. Keith and keep the IRB in step.
 */
export const DEFAULT_T2_OPEN_DAY = 28;

export function t2OpenDay(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.QUALTRICS_T2_DAY);
  return Number.isInteger(raw) && raw > 0 && raw <= 120 ? raw : DEFAULT_T2_OPEN_DAY;
}

interface WaveDefinition {
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
};

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

/** When a wave opens for this participant, or null if not yet known / never. */
export function waveOpensAt(
  wave: QualtricsWave,
  state: Pick<ParticipantSurveyState, "enrolledAt" | "midSurvey" | "firstPrivacyViewAt">,
  t2Day: number = t2OpenDay()
): string | null {
  const enrolled = new Date(state.enrolledAt).getTime();
  if (!Number.isFinite(enrolled)) return null;
  switch (wave) {
    case "T0":
      return new Date(enrolled).toISOString();
    case "T1":
      return state.firstPrivacyViewAt;
    case "MID":
      return state.midSurvey ? new Date(enrolled + MID_OPEN_DAY * DAY_MS).toISOString() : null;
    case "T2":
      return new Date(enrolled + t2Day * DAY_MS).toISOString();
  }
}

/** Qualtrics link for one wave, carrying the Study ID. */
export function buildSurveyUrl(
  wave: QualtricsWave,
  participantCode: string,
  opts: { peouBlock?: boolean | null; platform?: string; appVersion?: string | null } = {}
): string {
  const params = new URLSearchParams({ sid: participantCode, src: "app" });
  if (opts.platform) params.set("platform", opts.platform);
  if (opts.appVersion) params.set("app_version", opts.appVersion);
  if (wave === "T2" && opts.peouBlock) params.set("peou", "1");
  return `${QUALTRICS_HOST}/jfe/form/${WAVE_DEFINITIONS[wave].surveyId}?${params.toString()}`;
}

/** Every wave's status for one participant at `now`. */
export function surveyWaves(
  state: ParticipantSurveyState,
  now: Date = new Date(),
  t2Day: number = t2OpenDay()
): WaveView[] {
  return QUALTRICS_WAVES.map((wave) => {
    const def = WAVE_DEFINITIONS[wave];
    const base = { wave, title: def.title, minutes: def.minutes };
    if (wave === "MID" && state.midSurvey !== true) {
      return { ...base, status: "not_assigned" as const, opensAt: null, url: null };
    }
    const opensAt = waveOpensAt(wave, state, t2Day);
    if (state.markedDone.has(wave)) {
      return { ...base, status: "done" as const, opensAt, url: null };
    }
    const isOpen = opensAt !== null && new Date(opensAt).getTime() <= now.getTime();
    return {
      ...base,
      status: isOpen ? ("open" as const) : ("not_yet" as const),
      opensAt,
      url: isOpen ? buildSurveyUrl(wave, state.participantCode, { peouBlock: state.peouBlock }) : null,
    };
  });
}

export function isQualtricsWave(value: unknown): value is QualtricsWave {
  return typeof value === "string" && (QUALTRICS_WAVES as readonly string[]).includes(value);
}
