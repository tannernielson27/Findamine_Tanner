import { describe, it, expect } from "vitest";
import { cellKeyFor, nextBalancedFlag } from "@/lib/research/survey-halves";
import {
  buildSurveyUrl,
  surveyWaves,
  t2OpenDay,
  waveOpensAt,
  DEFAULT_T2_OPEN_DAY,
  type ParticipantSurveyState,
} from "@/lib/research/qualtrics";
import { isTestAccount, IN_APP_SURVEYS_ENABLED } from "@/lib/research/study-config";
import { nextSession, formatAppVersion, SESSION_IDLE_MS } from "@/lib/telemetry/envelope";
import { screenPath, huntIdFromPath, redactErrorText } from "@/lib/telemetry/client-events";
import { toEventRow } from "@/lib/telemetry/event-row";
import { daysBetween, qualtricsValues, QUALTRICS_COLUMN_HEADERS } from "@/lib/services/pilot-export";
import { escapeField } from "@/lib/services/research-export";

const ENROLLED = "2026-11-16T15:00:00.000Z";
const DAY = 86_400_000;
const at = (days: number) => new Date(new Date(ENROLLED).getTime() + days * DAY);

function state(over: Partial<ParticipantSurveyState> = {}): ParticipantSurveyState {
  return {
    participantCode: "FM-ABC234",
    enrolledAt: ENROLLED,
    midSurvey: true,
    peouBlock: false,
    firstPrivacyViewAt: null,
    markedDone: new Set(),
    ...over,
  };
}

describe("balanced survey halves", () => {
  it("keys a cell by sorted dimension=level pairs", () => {
    expect(
      cellKeyFor([
        { dimensionName: "privacy_default", level: "public" },
        { dimensionName: "forfeit_notice", level: "silent" },
        { dimensionName: "", level: "x" },
      ])
    ).toBe("forfeit_notice=silent|privacy_default=public");
  });

  it("gives the second of each pair the opposite of the first", () => {
    expect(nextBalancedFlag([true], () => 0)).toBe(false);
    expect(nextBalancedFlag([true, false, false], () => 0.9)).toBe(true);
  });

  it("flips a coin for the first of each pair", () => {
    expect(nextBalancedFlag([], () => 0.1)).toBe(true);
    expect(nextBalancedFlag([true, false], () => 0.9)).toBe(false);
  });

  it("ignores rows from before the column existed", () => {
    expect(nextBalancedFlag([null, true, undefined], () => 0.9)).toBe(false);
  });

  it("keeps every cell within one of 50/50", () => {
    let flags: boolean[] = [];
    let seed = 7;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 101; i++) {
      flags = [...flags, nextBalancedFlag(flags, rng)];
      const yes = flags.filter(Boolean).length;
      expect(Math.abs(yes - (flags.length - yes))).toBeLessThanOrEqual(1);
    }
  });
});

describe("Qualtrics schedule", () => {
  it("defaults T2 to day 28 and accepts a sane override", () => {
    expect(t2OpenDay({})).toBe(DEFAULT_T2_OPEN_DAY);
    expect(t2OpenDay({ QUALTRICS_T2_DAY: "42" })).toBe(42);
    expect(t2OpenDay({ QUALTRICS_T2_DAY: "abc" })).toBe(28);
    expect(t2OpenDay({ QUALTRICS_T2_DAY: "0" })).toBe(28);
  });

  it("opens T0 at enrollment, T1 at the first privacy view, MID at day 14, T2 at the T2 day", () => {
    const s = { enrolledAt: ENROLLED, midSurvey: true, firstPrivacyViewAt: "2026-11-16T16:00:00.000Z" };
    expect(waveOpensAt("T0", s, 28)).toBe(ENROLLED);
    expect(waveOpensAt("T1", s, 28)).toBe("2026-11-16T16:00:00.000Z");
    expect(waveOpensAt("MID", s, 28)).toBe(at(14).toISOString());
    expect(waveOpensAt("T2", s, 28)).toBe(at(28).toISOString());
    expect(waveOpensAt("MID", { ...s, midSurvey: false }, 28)).toBeNull();
  });

  it("puts the Study ID in every link and peou=1 only on T2 for the PEOU half", () => {
    const t2 = new URL(buildSurveyUrl("T2", "FM-ABC234", { peouBlock: true }));
    expect(t2.searchParams.get("sid")).toBe("FM-ABC234");
    expect(t2.searchParams.get("src")).toBe("app");
    expect(t2.searchParams.get("peou")).toBe("1");
    expect(t2.pathname).toBe("/jfe/form/SV_54maen9G7fb4g3Y");
    expect(new URL(buildSurveyUrl("T1", "FM-ABC234", { peouBlock: true })).searchParams.has("peou")).toBe(false);
    expect(new URL(buildSurveyUrl("T2", "FM-ABC234", { peouBlock: false })).searchParams.has("peou")).toBe(false);
  });

  it("reports open, not-yet, done and not-assigned waves", () => {
    const waves = surveyWaves(state({ firstPrivacyViewAt: null, markedDone: new Set(["T0"]) }), at(15), 28);
    const by = Object.fromEntries(waves.map((w) => [w.wave, w]));
    expect(by.T0.status).toBe("done");
    expect(by.T0.url).toBeNull();
    expect(by.T1.status).toBe("not_yet");
    expect(by.T1.opensAt).toBeNull();
    expect(by.MID.status).toBe("open");
    expect(by.MID.url).toContain("sid=FM-ABC234");
    expect(by.T2.status).toBe("not_yet");

    const noMid = surveyWaves(state({ midSurvey: false }), at(15), 28);
    expect(noMid.find((w) => w.wave === "MID")?.status).toBe("not_assigned");
  });
});

describe("study config", () => {
  it("keeps the in-app surveys off for the pilot", () => {
    expect(IN_APP_SURVEYS_ENABLED).toBe(false);
  });

  it("recognizes demo, flagged and .invalid accounts", () => {
    expect(isTestAccount({ email: "demo-simple@findamine.invalid" })).toBe(true);
    expect(isTestAccount({ email: "lt-001@LOADTEST.INVALID " })).toBe(true);
    expect(isTestAccount({ email: "a@byu.edu", metadata: { demo_account: true } })).toBe(true);
    expect(isTestAccount({ email: "a@byu.edu", metadata: { research_excluded: true } })).toBe(true);
    expect(isTestAccount({ email: "a@byu.edu", metadata: {} })).toBe(false);
    expect(isTestAccount(null)).toBe(false);
  });
});

describe("event envelope", () => {
  const makeId = () => "new";
  it("keeps a session through activity and starts a new one after the idle window", () => {
    expect(nextSession({ id: "old", lastActive: 1000 }, 1000 + SESSION_IDLE_MS, makeId).id).toBe("old");
    expect(nextSession({ id: "old", lastActive: 1000 }, 1001 + SESSION_IDLE_MS, makeId).id).toBe("new");
    expect(nextSession(null, 5, makeId)).toEqual({ id: "new", lastActive: 5 });
  });

  it("combines native and web versions", () => {
    expect(formatAppVersion("1.1 (2)", "abc1234")).toBe("1.1 (2)+web.abc1234");
    expect(formatAppVersion(null, "dev")).toBe("web.dev");
  });
});

describe("screen paths", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  it("drops query strings and replaces ids", () => {
    expect(screenPath(`/profile/${id}?tab=1#x`)).toBe("/profile/:id");
    expect(screenPath("/register?email=a@b.com")).toBe("/register");
    expect(screenPath(null)).toBe("");
  });

  it("keeps the hunt id only for hunt screens", () => {
    expect(huntIdFromPath(`/play/${id.toUpperCase()}`)).toBe(id);
    expect(huntIdFromPath(`/browse/${id}?x=1`)).toBe(id);
    expect(huntIdFromPath(`/profile/${id}`)).toBeNull();
  });
});

describe("error redaction", () => {
  it("removes emails, ids and query strings", () => {
    expect(
      redactErrorText(
        "Failed for jo.smith+x@byu.edu at https://x.app/api/v1/users/0f8fad5b-d9cb-469f-a165-70867728950e?code=123456"
      )
    ).toBe("Failed for <email> at https://x.app/api/v1/users/:id?…");
  });
});

describe("export and telemetry hardening", () => {
  it("neutralizes spreadsheet formulas but keeps negative numbers", () => {
    expect(escapeField('=HYPERLINK("x")', ",")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeField("@cmd", ",")).toBe("'@cmd");
    expect(escapeField("-0.25", ",")).toBe("-0.25");
    expect(escapeField("-1+1", ",")).toBe("'-1+1");
  });

  it("drops free-text envelope fields", () => {
    const row = toEventRow("u1", { event_type: "app_state", event_name: "=1+1", session_id: "a b;c", app_version: "1.1 (2)+web.abc" });
    expect(row?.event_name).toBeNull();
    expect(row?.session_id).toBeNull();
    expect(row?.app_version).toBe("1.1 (2)+web.abc");
  });

  it("redacts tokens and fragments in error text", () => {
    expect(redactErrorText("auth Bearer abc.def failed")).toBe("auth Bearer <token> failed");
    expect(redactErrorText("jwt eyJhbGciOi.eyJzdWIiOjF9.sig here")).toBe("jwt <token> here");
    expect(redactErrorText(`key ${"a1".repeat(20)} end`)).toBe("key <token> end");
    expect(redactErrorText("https://x.app/reset#access_token=zzz")).toBe("https://x.app/reset#…");
  });
});

describe("batch event validation", () => {
  it("builds a row with the envelope and the client timestamp in the payload", () => {
    const row = toEventRow("u1", {
      event_type: "screen_view",
      event_name: "/dashboard",
      payload: { path: "/dashboard" },
      session_id: "s1",
      platform: "ios",
      app_version: "1.1 (2)+web.abc",
      client_ts: "2026-11-16T15:00:00.000Z",
    });
    expect(row).toEqual({
      user_id: "u1",
      session_id: "s1",
      event_type: "screen_view",
      event_name: "/dashboard",
      payload: { path: "/dashboard", client_ts: "2026-11-16T15:00:00.000Z" },
      platform: "ios",
      app_version: "1.1 (2)+web.abc",
    });
  });

  it("rejects malformed events and drops unknown platforms", () => {
    expect(toEventRow("u1", null)).toBeNull();
    expect(toEventRow("u1", { event_type: "" })).toBeNull();
    expect(toEventRow("u1", { event_type: "app_state", payload: { big: "x".repeat(5000) } })).toBeNull();
    expect(toEventRow("u1", { event_type: "app_state", platform: "windows" })?.platform).toBeNull();
  });

  it("refuses study events a client could forge", () => {
    for (const forged of ["referral_bonus_forfeited", "forfeit_notice_eligible", "forfeit_notice_viewed", "privacy_change", "study_enrolled"]) {
      expect(toEventRow("u1", { event_type: forged, payload: { amount: 999 } })).toBeNull();
    }
  });
});

describe("pilot export columns", () => {
  it("computes non-negative day offsets", () => {
    expect(daysBetween(ENROLLED, at(1.5).toISOString(), 2)).toBe("1.50");
    expect(daysBetween(ENROLLED, at(-1).toISOString())).toBe("");
    expect(daysBetween(null, ENROLLED)).toBe("");
  });

  it("lists subset flags and per-wave open / first launch / done times", () => {
    const enrollment = {
      study_id: "s",
      user_id: "u",
      participant_code: "FM-ABC234",
      enrolled_at: ENROLLED,
      mid_survey: false,
      peou_block: true,
    };
    const launches = [
      { user_id: "u", wave: "T0", action: "launched", created_at: "2026-11-16T15:05:00.000Z" },
      { user_id: "u", wave: "T0", action: "launched", created_at: "2026-11-16T15:06:00.000Z" },
      { user_id: "u", wave: "T0", action: "marked_done", created_at: "2026-11-16T15:10:00.000Z" },
    ];
    const values = qualtricsValues(enrollment, null, launches, 28);
    expect(values).toHaveLength(QUALTRICS_COLUMN_HEADERS.length);
    const row = Object.fromEntries(QUALTRICS_COLUMN_HEADERS.map((h, i) => [h, values[i]]));
    expect(row.mid_survey).toBe("0");
    expect(row.peou_block).toBe("1");
    expect(row.q_t0_opens_at).toBe(ENROLLED);
    expect(row.q_t0_first_launch_at).toBe("2026-11-16T15:05:00.000Z");
    expect(row.q_t0_marked_done_at).toBe("2026-11-16T15:10:00.000Z");
    expect(row.q_t1_opens_at).toBe("");
    expect(row.q_mid_opens_at).toBe("");
    expect(row.q_t2_opens_at).toBe(at(28).toISOString());
  });
});
