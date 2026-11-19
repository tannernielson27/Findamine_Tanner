import { describe, it, expect } from "vitest";
import {
  buildSurveyUrl,
  isQualtricsWave,
  surveyPlanFor,
  surveyWaves,
  twoWaveConfig,
  waveOpensAt,
  END_FALLBACK_DAY,
  FOUR_WAVE_PLAN,
  START_FALLBACK_HOURS,
  TWO_WAVE_PLAN,
  WAVE_DEFINITIONS,
  type ParticipantSurveyState,
  type TwoWaveConfig,
} from "@/lib/research/qualtrics";
import { QUALTRICS_COLUMN_HEADERS } from "@/lib/services/pilot-export";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FROM = "2026-11-30T00:00:00-07:00";
const ENROLLED = "2026-11-30T17:00:00.000Z"; // Monday 10:00 Mountain Time
const PILOT_ENROLLED = "2026-11-18T17:00:00.000Z";
const END_OPENS = "2026-12-08T08:00:00-07:00";
const after = (iso: string, ms: number) => new Date(Date.parse(iso) + ms);

const ENV = {
  QUALTRICS_TWO_WAVE_FROM: FROM,
  QUALTRICS_START_SURVEY_ID: "SV_startSURVEY0001",
  QUALTRICS_END_SURVEY_ID: "SV_endSURVEY00002",
  QUALTRICS_END_OPENS_AT: END_OPENS,
};
const CONFIG = twoWaveConfig(ENV) as TwoWaveConfig;

function state(over: Partial<ParticipantSurveyState> = {}): ParticipantSurveyState {
  return {
    participantCode: "FM-ABC234",
    enrolledAt: ENROLLED,
    midSurvey: true,
    peouBlock: true,
    firstPrivacyViewAt: null,
    markedDone: new Set(),
    ...over,
  };
}

describe("two-wave survey config", () => {
  it("is off unless a start instant is set, and reads the rest when it is", () => {
    expect(twoWaveConfig({})).toBeNull();
    expect(twoWaveConfig({ QUALTRICS_TWO_WAVE_FROM: "soon" })).toBeNull();
    expect(twoWaveConfig({ QUALTRICS_START_SURVEY_ID: "SV_startSURVEY0001" })).toBeNull();
    expect(CONFIG).toEqual({
      fromMs: Date.parse(FROM),
      startSurveyId: "SV_startSURVEY0001",
      endSurveyId: "SV_endSURVEY00002",
      endOpensAtMs: Date.parse(END_OPENS),
    });
  });

  it("drops a survey ID that could not be a Qualtrics survey", () => {
    const config = twoWaveConfig({
      QUALTRICS_TWO_WAVE_FROM: FROM,
      QUALTRICS_START_SURVEY_ID: "https://evil.example/?x=",
      QUALTRICS_END_SURVEY_ID: " SV_endSURVEY00002 ",
      QUALTRICS_END_OPENS_AT: "next week",
    });
    expect(config).toMatchObject({ startSurveyId: null, endSurveyId: "SV_endSURVEY00002", endOpensAtMs: null });
  });
});

describe("which plan a participant is on", () => {
  it("keeps everyone on four waves while the two-wave plan is off", () => {
    expect(surveyPlanFor(ENROLLED, null)).toBe(FOUR_WAVE_PLAN);
    expect(surveyWaves(state(), after(ENROLLED, DAY), 28, null).map((w) => w.wave)).toEqual(["T0", "T1", "MID", "T2"]);
  });

  it("puts enrollments from the start instant on two waves and leaves the pilot alone", () => {
    expect(surveyPlanFor(FROM, CONFIG)).toBe(TWO_WAVE_PLAN);
    expect(surveyPlanFor(ENROLLED, CONFIG)).toBe(TWO_WAVE_PLAN);
    expect(surveyPlanFor(PILOT_ENROLLED, CONFIG)).toBe(FOUR_WAVE_PLAN);
    expect(surveyPlanFor("not a date", CONFIG)).toBe(FOUR_WAVE_PLAN);

    const pilot = surveyWaves(state({ enrolledAt: PILOT_ENROLLED }), after(PILOT_ENROLLED, 15 * DAY), 28, CONFIG);
    expect(pilot.map((w) => w.wave)).toEqual(["T0", "T1", "MID", "T2"]);
    expect(pilot.find((w) => w.wave === "MID")?.status).toBe("open");
  });

  it("never gives a wave from the other plan an opening time", () => {
    const pilot = { enrolledAt: PILOT_ENROLLED, midSurvey: true, firstPrivacyViewAt: PILOT_ENROLLED };
    const cohort = { enrolledAt: ENROLLED, midSurvey: true, firstPrivacyViewAt: ENROLLED };
    for (const wave of TWO_WAVE_PLAN) expect(waveOpensAt(wave, pilot, 28, CONFIG)).toBeNull();
    for (const wave of FOUR_WAVE_PLAN) expect(waveOpensAt(wave, cohort, 28, CONFIG)).toBeNull();
  });
});

describe("two-wave schedule", () => {
  it("opens START at the first look at the privacy settings, or a day after enrolling", () => {
    const viewed = after(ENROLLED, 10 * 60_000).toISOString();
    const base = { enrolledAt: ENROLLED, midSurvey: null };
    expect(waveOpensAt("START", { ...base, firstPrivacyViewAt: viewed }, 28, CONFIG)).toBe(viewed);
    expect(waveOpensAt("START", { ...base, firstPrivacyViewAt: null }, 28, CONFIG)).toBe(
      after(ENROLLED, START_FALLBACK_HOURS * HOUR).toISOString()
    );
    // A first look three days in does not hold START back past the fallback.
    expect(waveOpensAt("START", { ...base, firstPrivacyViewAt: after(ENROLLED, 3 * DAY).toISOString() }, 28, CONFIG)).toBe(
      after(ENROLLED, START_FALLBACK_HOURS * HOUR).toISOString()
    );
  });

  it("opens END at the cohort's instant, never within a day of enrolling", () => {
    const base = { enrolledAt: ENROLLED, midSurvey: null, firstPrivacyViewAt: null };
    expect(waveOpensAt("END", base, 28, CONFIG)).toBe(new Date(END_OPENS).toISOString());

    const late = after(END_OPENS, -2 * HOUR).toISOString();
    expect(waveOpensAt("END", { ...base, enrolledAt: late }, 28, CONFIG)).toBe(after(late, DAY).toISOString());

    const noDate = { ...CONFIG, endOpensAtMs: null };
    expect(waveOpensAt("END", base, 28, noDate)).toBe(after(ENROLLED, END_FALLBACK_DAY * DAY).toISOString());
  });

  it("walks a participant through not-yet, open and done", () => {
    const viewed = after(ENROLLED, 5 * 60_000).toISOString();
    const beforeTour = surveyWaves(state(), after(ENROLLED, 60_000), 28, CONFIG);
    expect(beforeTour.map((w) => [w.wave, w.status])).toEqual([["START", "not_yet"], ["END", "not_yet"]]);

    const afterTour = surveyWaves(state({ firstPrivacyViewAt: viewed }), after(ENROLLED, 6 * 60_000), 28, CONFIG);
    const start = afterTour[0];
    expect(start.status).toBe("open");
    const url = new URL(start.url ?? "missing:");
    expect(url.pathname).toBe("/jfe/form/SV_startSURVEY0001");
    expect(url.searchParams.get("sid")).toBe("FM-ABC234");
    // The PEOU half-split belongs to the pilot's T2 only.
    expect(url.searchParams.has("peou")).toBe(false);
    expect(afterTour[1].status).toBe("not_yet");

    const lastClass = surveyWaves(
      state({ firstPrivacyViewAt: viewed, markedDone: new Set(["START"]) }),
      after(END_OPENS, HOUR),
      28,
      CONFIG
    );
    expect(lastClass.map((w) => [w.wave, w.status])).toEqual([["START", "done"], ["END", "open"]]);
    expect(lastClass[1].url).toContain("/jfe/form/SV_endSURVEY00002?");
    expect(new URL(lastClass[1].url ?? "missing:").searchParams.has("peou")).toBe(false);
  });

  it("keeps a wave closed, with no link, while its survey ID is not set", () => {
    const config = { ...CONFIG, startSurveyId: null };
    expect(buildSurveyUrl("START", "FM-ABC234", {}, config)).toBeNull();
    const waves = surveyWaves(state({ firstPrivacyViewAt: ENROLLED }), after(ENROLLED, DAY), 28, config);
    expect(waves[0]).toMatchObject({ wave: "START", status: "not_yet", url: null });
    expect(waves[0].opensAt).toBe(ENROLLED);
  });
});

describe("two-wave bookkeeping", () => {
  it("accepts the new wave names and gives them export columns", () => {
    expect(isQualtricsWave("START")).toBe(true);
    expect(isQualtricsWave("END")).toBe(true);
    expect(isQualtricsWave("start")).toBe(false);
    expect(QUALTRICS_COLUMN_HEADERS).toEqual(
      expect.arrayContaining(["q_t0_opens_at", "q_start_opens_at", "q_start_marked_done_at", "q_end_first_launch_at"])
    );
  });

  it("titles the new surveys without naming what the study is about", () => {
    for (const wave of TWO_WAVE_PLAN) {
      expect(WAVE_DEFINITIONS[wave].title).not.toMatch(/privacy|expect/i);
    }
  });
});
