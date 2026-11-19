/**
 * The surfaces around scoring version 2 (issue #11) that sit outside the
 * scorer itself: the hunt page's Scoring setting, the solve time on the result
 * card, hunt analytics on either scale, and the places that list or combine
 * session totals from hunts on different versions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { installDouble, type Row } from "@/__tests__/support/supabase-double";

const h = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({ generalLimiter: { check: async () => {} } }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/utils/leaderboard-visibility", () => ({
  resolveLeaderboardVisibility: async (_viewer: string | null, ids: string[]) => ({
    drop: new Set(ids.filter((id) => id === "hidden")),
    nameAllowed: new Map(ids.map((id) => [id, id !== "shy"])),
  }),
}));

import {
  DEFAULT_SOLVE_WINDOW_MINUTES,
  SCORING_VERSION_LABELS,
  inheritScoringSettings,
  isValidSolveWindowInput,
  readScoringVersion,
  readSolveWindowMinutes,
  scoringSettingsChanged,
  stopScorePercent,
  withComparableTotals,
  withScoringSettings,
} from "@/lib/hunts/scoring-version";
import { formatSolveDuration, v2BreakdownRows } from "@/lib/play/score-breakdown";
import { ScoringSettings } from "@/components/hunts/scoring-settings";
import { StopResults } from "@/components/play/stop-results";
import { GET as leaderboardTypes } from "@/app/api/v1/leaderboard/types/route";
import { GET as huntAnalytics } from "@/app/api/v1/hunts/[id]/analytics/route";

const render = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(el).replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
});

describe("withScoringSettings", () => {
  it("writes the version and the window, leaving other settings alone and the input untouched", () => {
    const before = { hide_scores: true, scoring_version: 1 };
    const next = withScoringSettings(before, 2, 90);
    expect(next).toEqual({ hide_scores: true, scoring_version: 2, scoring_solve_window_min: 90 });
    expect(before).toEqual({ hide_scores: true, scoring_version: 1 });
  });

  it("clears the window with an explicit null, which the API reads as 'use the default'", () => {
    const stored = { scoring_version: 2, scoring_solve_window_min: 90 };
    const next = withScoringSettings(stored, 2, null);
    expect(next.scoring_solve_window_min).toBeNull();
    // Leaving the key out would have kept the stored 90.
    expect(readSolveWindowMinutes(inheritScoringSettings(stored, next))).toBeNull();
    expect(scoringSettingsChanged(stored, next)).toBe(true);
  });

  it("gives version 1 no window", () => {
    expect(withScoringSettings({ scoring_version: 2, scoring_solve_window_min: 90 }, 1, 90)).toEqual({
      scoring_version: 1,
      scoring_solve_window_min: null,
    });
  });

  it("starts from nothing for a hunt with no metadata", () => {
    expect(readScoringVersion(withScoringSettings(null, 2, null))).toBe(2);
  });
});

describe("isValidSolveWindowInput", () => {
  it("accepts the default (null) and whole minutes from 5 to 1440", () => {
    for (const ok of [null, 5, 60, 1440]) expect(isValidSolveWindowInput(ok)).toBe(true);
    for (const bad of [4, 1441, 0, -5, 7.5, Number.NaN]) expect(isValidSolveWindowInput(bad)).toBe(false);
  });
});

describe("stopScorePercent", () => {
  it("reads the same share on either version", () => {
    expect(stopScorePercent(71, 1)).toBe(71);
    expect(stopScorePercent(710, 2)).toBe(71);
    expect(stopScorePercent(891, 2)).toBeCloseTo(89.1);
  });

  it("stays between 0 and 100, and treats a missing score as 0", () => {
    expect(stopScorePercent(1500, 2)).toBe(100);
    expect(stopScorePercent(-3, 1)).toBe(0);
    expect(stopScorePercent(null, 2)).toBe(0);
    expect(stopScorePercent(Number.NaN, 1)).toBe(0);
  });
});

describe("withComparableTotals", () => {
  const rows = [
    { user_id: "a", total_score: 3564, hunts: { title: "Timed hunt", metadata: { scoring_version: 2, clue_orders: [["x"]] } } },
    { user_id: "b", total_score: 284, hunts: { title: "Classic hunt", metadata: {} } },
    { user_id: "c", total_score: 300, hunts: [{ title: "Array embed", metadata: { scoring_version: 2 } }] },
    { user_id: "d", total_score: null, hunts: null },
  ];

  it("puts a version 2 total on the common scale and leaves a version 1 total as it is", () => {
    expect(withComparableTotals(rows).map((r) => r.total_score)).toEqual([356, 284, 30, null]);
  });

  it("drops the hunt's metadata, keeps its other fields, and does not change its input", () => {
    const out = withComparableTotals(rows);
    expect(out[0].hunts).toEqual({ title: "Timed hunt" });
    expect(out[2].hunts).toEqual([{ title: "Array embed" }]);
    expect(JSON.stringify(out)).not.toContain("clue_orders");
    expect(rows[0].total_score).toBe(3564);
    expect(rows[0].hunts).toHaveProperty("metadata");
  });

  it("treats a session whose hunt is gone as version 1", () => {
    expect(withComparableTotals([{ total_score: 90, hunts: null }])[0].total_score).toBe(90);
  });
});

describe("formatSolveDuration", () => {
  it("reads as a person would say it", () => {
    expect(formatSolveDuration(45_000)).toBe("45 s");
    expect(formatSolveDuration(192_000)).toBe("3 min 12 s");
    expect(formatSolveDuration(180_000)).toBe("3 min");
    expect(formatSolveDuration(3_900_000)).toBe("1 h 5 min");
    expect(formatSolveDuration(7_200_000)).toBe("2 h");
    expect(formatSolveDuration(0)).toBe("0 s");
  });

  it("rounds to the second and never shows 60 s", () => {
    expect(formatSolveDuration(59_600)).toBe("1 min");
    expect(formatSolveDuration(1_400)).toBe("1 s");
  });

  it("says nothing for a time it doesn't have", () => {
    for (const none of [null, undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatSolveDuration(none)).toBeNull();
    }
  });
});

describe("the speed row of the version 2 breakdown", () => {
  const breakdown = { correctness: 500, firstAttemptBonus: 100, completion: 100, solveTime: 191, releaseTime: 0, hintPenalty: 0 };

  it("says how long the stop took when the server sent the time", () => {
    const speed = v2BreakdownRows(breakdown, 5 * 60_000).find((r) => r.label === "Speed on this stop");
    expect(speed).toEqual({ label: "Speed on this stop", points: 191, detail: "Solved in 5 min" });
  });

  it("has no note without a time", () => {
    const speed = v2BreakdownRows(breakdown).find((r) => r.label === "Speed on this stop");
    expect(speed).toEqual({ label: "Speed on this stop", points: 191 });
  });
});

describe("StopResults on a version 2 stop", () => {
  const noop = () => {};
  const base = {
    huntId: "h1",
    findId: "f1",
    stopNumber: 1,
    totalStops: 4,
    completedStops: 1,
    isLastStop: false,
    phase: "feedback" as const,
    score: 891,
    hideScores: false,
    feedback: null,
    breakdown: { correctness: 500, firstAttemptBonus: 100, completion: 100, solveTime: 191, releaseTime: 0, hintPenalty: 0 },
    alreadyCompleted: false,
    error: null,
    noticeVisible: false,
    uploadingPhoto: false,
    finishing: false,
    onPhoto: async () => {},
    onSkipPhoto: noop,
    onNext: noop,
    onFinish: noop,
    onPrevious: null,
    onDismissError: noop,
    onError: noop,
  };

  it("shows the solve time under the speed points", () => {
    const html = render(createElement(StopResults, { ...base, solveMs: 192_000 }));
    expect(html).toContain("Speed on this stop");
    expect(html).toContain("Solved in 3 min 12 s");
  });

  it("shows the breakdown without a time when none came back", () => {
    const html = render(createElement(StopResults, base));
    expect(html).toContain("Speed on this stop");
    expect(html).not.toContain("Solved in");
  });
});

describe("ScoringSettings", () => {
  const base = { busy: false, onSave: async () => true };

  it("lets the creator of an unplayed draft choose the version and the window", () => {
    const html = render(createElement(ScoringSettings, { ...base, metadata: { scoring_version: 2 }, draft: true, played: false }));
    expect(html).toContain(SCORING_VERSION_LABELS[1]);
    expect(html).toContain(SCORING_VERSION_LABELS[2]);
    expect(html).toMatch(/<input[^>]*id="scoring-version-2"[^>]*checked=""/);
    expect(html).toContain("Speed points run out after");
    expect(html).toContain(`placeholder="${DEFAULT_SOLVE_WINDOW_MINUTES}"`);
    expect(html).toContain("Save scoring");
    // Nothing changed yet, so there is nothing to save.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save scoring/);
  });

  it("shows a stored window, and no window field on the classic version", () => {
    const timed = render(createElement(ScoringSettings, { ...base, metadata: { scoring_version: 2, scoring_solve_window_min: 90 }, draft: true, played: false }));
    expect(timed).toContain('value="90"');
    const classic = render(createElement(ScoringSettings, { ...base, metadata: {}, draft: true, played: false }));
    expect(classic).toMatch(/<input[^>]*id="scoring-version-1"[^>]*checked=""/);
    expect(classic).not.toContain("Speed points run out after");
  });

  it("is read-only once the hunt has been played, and says to clone", () => {
    const html = render(createElement(ScoringSettings, { ...base, metadata: { scoring_version: 2, scoring_solve_window_min: 90 }, draft: true, played: true }));
    expect(html).not.toContain('type="radio"');
    expect(html).not.toContain("Save scoring");
    expect(html).toContain(SCORING_VERSION_LABELS[2]);
    expect(html).toContain("Speed points run out after 90 minutes.");
    expect(html).toContain("Clone the hunt to use different scoring");
  });

  it("is read-only on a published hunt nobody has played, without telling them to clone", () => {
    const html = render(createElement(ScoringSettings, { ...base, metadata: {}, draft: false, played: false }));
    expect(html).not.toContain('type="radio"');
    expect(html).toContain(SCORING_VERSION_LABELS[1]);
    expect(html).toContain("Scoring can be changed while the hunt is a draft.");
    expect(html).not.toContain("Clone");
  });
});

describe("GET /leaderboard/types (weekly, monthly, by subject)", () => {
  const board = (query: string) => leaderboardTypes(new NextRequest(`http://localhost:3000/api/v1/leaderboard/types?${query}`));

  function seed(rows: Row[]) {
    const calls: Row[] = [];
    installDouble({}, { rpc: { get_session_leaderboard: (args) => (calls.push(args), rows) } });
    return calls;
  }

  it("ranks in the database on the common scale and keeps the response shape", async () => {
    const calls = seed([
      { user_id: "a", total_score: 356, display_name: "Ada" },
      { user_id: "b", total_score: 284, display_name: "Bo" },
    ]);
    const body = await (await board("type=weekly&limit=10")).json();
    expect(body.period).toBe("last_7_days");
    expect(body.entries).toEqual([
      { user_id: "a", total_score: 356, users: { display_name: "Ada" } },
      { user_id: "b", total_score: 284, users: { display_name: "Bo" } },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_subject: null, p_limit: 10 });
    const sinceDays = (Date.now() - Date.parse(String(calls[0].p_since))) / 86_400_000;
    expect(sinceDays).toBeGreaterThan(6.99);
    expect(sinceDays).toBeLessThan(7.01);
  });

  it("asks for 30 days on the monthly board and for the subject with no time limit on the subject board", async () => {
    const monthly = seed([]);
    await board("type=monthly");
    expect((Date.now() - Date.parse(String(monthly[0].p_since))) / 86_400_000).toBeCloseTo(30, 1);
    expect(monthly[0].p_limit).toBe(25);

    const subject = seed([]);
    const body = await (await board("type=subject_specific&subject=history")).json();
    expect(subject[0]).toMatchObject({ p_since: null, p_subject: "history" });
    expect(body).toMatchObject({ type: "subject_specific", subject: "history", entries: [] });
  });

  it("still leaves out players who hide their score and hides names that are not shared", async () => {
    seed([
      { user_id: "hidden", total_score: 900, display_name: "Hidden" },
      { user_id: "shy", total_score: 400, display_name: "Shy" },
    ]);
    const body = await (await board("type=weekly")).json();
    expect(body.entries).toEqual([{ user_id: "shy", total_score: 400, users: { display_name: "Anonymous" } }]);
  });

  it("answers 500 without database detail when the function fails", async () => {
    installDouble({}, { rpc: { get_session_leaderboard: () => { throw new Error("function public.get_session_leaderboard does not exist"); } } });
    const res = await board("type=weekly");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("get_session_leaderboard");
  });
});

describe("GET /hunts/[id]/analytics", () => {
  const HUNT = "11111111-1111-4111-8111-111111111111";
  const get = () =>
    huntAnalytics(new NextRequest(`http://localhost:3000/api/v1/hunts/${HUNT}/analytics`), { params: Promise.resolve({ id: HUNT }) });

  function seed(metadata: Row) {
    installDouble(
      {
        hunts: [{ id: HUNT, title: "Hunt", created_by: "u1", status: "published", deleted_at: null, metadata }],
        play_sessions: [],
        finds: [],
      },
      { embeds: { finds: { locations: { table: "locations", localKey: "location_id" } } } }
    );
  }

  it("says what a stop is out of, so the page can scale its bars", async () => {
    seed({ scoring_version: 2 });
    expect(await (await get()).json()).toMatchObject({ analytics_available: true, scoring_version: 2, stop_max_score: 1000 });
    seed({});
    expect(await (await get()).json()).toMatchObject({ scoring_version: 1, stop_max_score: 100 });
  });
});
