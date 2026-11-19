import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Route-level tests for scoring version 2 (issue #11): the answer route scores
 * a version 2 hunt from the stop's own start, version 1 hunts score as before,
 * new hunts get version 2, and scoring locks once a hunt has been played.
 */

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  referral: vi.fn(async () => {}),
}));

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
vi.mock("@/lib/utils/rate-limit", () => ({
  playLimiter: { check: async () => {} },
  generalLimiter: { check: async () => {} },
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/services/referral", () => ({ awardReferralPoints: h.referral }));
vi.mock("@/lib/services/privacy-notice", () => ({ recordPrivacyNotice: async () => null }));
vi.mock("@/lib/services/gamification", () => ({
  updateStreak: async () => ({ current: 1, longest: 1, justBroke: false, badgesEarned: [] }),
  evaluateBadges: async () => [],
}));
vi.mock("@/lib/utils/run-after", () => ({ runAfter: (_name: string, fn: () => unknown) => void fn() }));

import { POST as answer } from "@/app/api/v1/play/[huntId]/answer/route";
import { POST as clueHint } from "@/app/api/v1/play/[huntId]/clue-hint/route";
import { POST as createHunt } from "@/app/api/v1/hunts/route";
import { PUT as updateHunt } from "@/app/api/v1/hunts/[id]/route";
import { GET as leaderboard } from "@/app/api/v1/leaderboard/route";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const FIND = "find-1";
const MIN = 60_000;
const NOW = Date.parse("2026-11-18T18:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const playParams = { params: Promise.resolve({ huntId: HUNT }) };
const huntParams = { params: Promise.resolve({ id: HUNT }) };

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** A hunt with one keyed stop; the session began 3 hours ago, the stop 5 minutes ago. */
function seedPlay(huntMetadata: Row, completion: Row = {}): SupabaseDouble {
  return installDouble(
    {
      hunts: [{ id: HUNT, status: "published", review_status: "approved", identity_mode: "real_name", metadata: huntMetadata }],
      play_sessions: [
        { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: ago(180 * MIN), total_score: 0, metadata: {} },
      ],
      tasks: [{ id: "task-1", challenge_type: "short_text", content: { correct_answer: "oak" } }],
      finds: [{ id: FIND, hunt_id: HUNT, task_id: "task-1", sort_order: 0, deleted_at: null, clue_hints: ["Look up"] }],
      find_completions: [
        {
          id: "comp-1",
          play_session_id: SESSION,
          find_id: FIND,
          started_at: ago(5 * MIN),
          arrived_at: ago(1 * MIN),
          completed_at: null,
          hints_used: 0,
          clue_hints_used: 0,
          metadata: {},
          created_at: ago(5 * MIN),
          ...completion,
        },
      ],
    },
    { embeds: { finds: { tasks: { table: "tasks", localKey: "task_id" } } } }
  );
}

const submit = (value: string) => answer(req("POST", "/answer", { find_id: FIND, answer: value }), playParams);

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
  h.referral.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /play/[huntId]/answer on a version 2 hunt", () => {
  it("scores from the stop's own start, not the start of the session", async () => {
    const db = seedPlay({ scoring_version: 2 });
    const body = await (await submit("oak")).json();
    // 5 minutes on this stop: 500 + 100 + 100 + 191. From the session start
    // (3 hours ago) the time layer would be worth nothing.
    expect(body).toMatchObject({ score: 891, scoring_version: 2, max_score: 1000, solve_ms: 5 * MIN, is_complete: true });
    expect(body.breakdown).toEqual({
      correctness: 500,
      firstAttemptBonus: 100,
      completion: 100,
      solveTime: 191,
      releaseTime: 0,
      hintPenalty: 0,
      effortCredit: 0,
    });
    expect(db.table("find_completions")[0].score).toBe(891);
  });

  it("ignores any time or score the client sends", async () => {
    seedPlay({ scoring_version: 2 });
    const res = await answer(
      req("POST", "/answer", { find_id: FIND, answer: "oak", solve_ms: 1, started_at: ago(0), score: 1000, time_spent: 0 }),
      playParams
    );
    expect((await res.json()).score).toBe(891);
  });

  it("records the version, the per-layer breakdown and what the time layers were computed from", async () => {
    const db = seedPlay({ scoring_version: 2 });
    await submit("oak");
    const meta = db.table("find_completions")[0].metadata as Row;
    expect(meta.scoring_version).toBe(2);
    expect(meta.scoring_breakdown).toMatchObject({ solveTime: 191, releaseTime: 0 });
    expect(meta.scoring_timing).toEqual({
      started_at: ago(5 * MIN),
      answered_at: ago(0),
      solve_ms: 5 * MIN,
      solve_tau_ms: 2 * MIN,
      solve_window_ms: 60 * MIN,
      solve_weight: 300,
      release_active: false,
      released_at: null,
      release_ms: null,
      release_tau_ms: 10 * MIN,
      release_window_ms: 24 * 60 * MIN,
      release_weight: 0,
    });
  });

  it("uses the hunt's own solve window", async () => {
    seedPlay({ scoring_version: 2, scoring_solve_window_min: 180 });
    const body = await (await submit("oak")).json();
    expect(body.breakdown.solveTime).toBe(Math.round(300 * (1 - Math.log(3.5) / Math.log(91))));
  });

  it("falls back to the arrival for a row with no start time", async () => {
    seedPlay({ scoring_version: 2 }, { started_at: null, arrived_at: ago(2 * MIN) });
    const body = await (await submit("oak")).json();
    expect(body.solve_ms).toBe(2 * MIN);
  });

  it("gives a wrong answer the floor and no time points, then decays the retry", async () => {
    const db = seedPlay({ scoring_version: 2 });
    const wrong = await (await submit("maple")).json();
    expect(wrong).toMatchObject({ score: 50, is_complete: false, can_retry: true });
    expect(wrong.breakdown.solveTime).toBe(0);
    const right = await (await submit("oak")).json();
    expect(right.score).toBe(425 + 100 + 191);
    expect((db.table("find_completions")[0].metadata as Row).attempt_count).toBe(2);
  });

  it("charges 20 per clue hint and 50 per challenge hint", async () => {
    seedPlay({ scoring_version: 2 }, { clue_hints_used: 2, hints_used: 1 });
    const body = await (await submit("oak")).json();
    expect(body.breakdown.hintPenalty).toBe(90);
    expect(body.score).toBe(801);
  });

  it("enters the stop in the points ledger and referral share out of 100, not 1000", async () => {
    const db = seedPlay({ scoring_version: 2 });
    await submit("oak");
    expect(db.table("points_ledger")[0]).toMatchObject({ amount: 89, source_type: "challenge" });
    expect(h.referral).toHaveBeenCalledWith("u1", 89, FIND, HUNT);
  });

  it("saves the session's total score and total solve time for the leaderboard tiebreak", async () => {
    const db = seedPlay({ scoring_version: 2 });
    await submit("oak");
    expect(db.table("play_sessions")[0]).toMatchObject({ total_score: 891, total_solve_ms: 5 * MIN });
  });

  it("tells the player what a clue hint costs on this hunt", async () => {
    seedPlay({ scoring_version: 2 });
    const v2 = await (await clueHint(req("POST", "/clue-hint", { find_id: FIND, level: 1 }), playParams)).json();
    expect(v2.penalty_per_hint).toBe(20);
    seedPlay({});
    const v1 = await (await clueHint(req("POST", "/clue-hint", { find_id: FIND, level: 1 }), playParams)).json();
    expect(v1.penalty_per_hint).toBe(2);
  });
});

describe("POST /play/[huntId]/answer on a version 1 hunt", () => {
  it("scores exactly as before and records version 1", async () => {
    const db = seedPlay({});
    const body = await (await submit("oak")).json();
    expect(body).toMatchObject({ score: 71, scoring_version: 1, max_score: 100, solve_ms: null });
    expect(body.breakdown).toEqual({ correctness: 60, masteryBonus: 8, completion: 3, speed: 0, hintPenalty: 0, effortCredit: 0 });
    const meta = db.table("find_completions")[0].metadata as Row;
    expect(meta.scoring_version).toBe(1);
    expect(meta.scoring_timing).toBeUndefined();
    expect(db.table("points_ledger")[0]).toMatchObject({ amount: 71, description: "Scored 71 on find" });
    expect(h.referral).toHaveBeenCalledWith("u1", 71, FIND, HUNT);
  });

  it("still measures its speed bonus from the session start", async () => {
    // Expected time 10 minutes: 5 minutes on the stop would earn the bonus,
    // 3 hours since the session began does not. Version 1 keeps the latter.
    const db = seedPlay({});
    (db.table("tasks")[0].content as Row).expected_time_seconds = 600;
    expect((await (await submit("oak")).json()).breakdown.speed).toBe(0);
  });
});

describe("hunt scoring version", () => {
  beforeEach(() => {
    h.user = { id: "creator", role: "hunt_creator" };
  });

  const seedHunt = (metadata: Row, sessions: Row[] = []) =>
    installDouble(
      {
        hunts: [{ id: HUNT, title: "Hunt", status: "draft", review_status: "not_submitted", created_by: "creator", deleted_at: null, metadata }],
        play_sessions: sessions,
        finds: [],
        hunt_clue_orders: [],
      },
      { unique: { hunt_clue_orders: [["hunt_id"]] } }
    );
  const played = [{ id: SESSION, hunt_id: HUNT, user_id: "u1", status: "completed" }];
  const put = (metadata: Row) => updateHunt(req("PUT", "/hunts", { metadata }), huntParams);

  it("gives a hunt created now version 2", async () => {
    const db = installDouble({ hunts: [] });
    const res = await createHunt(req("POST", "/hunts", { title: "New hunt", metadata: { preset: "practice" } }));
    expect(res.status).toBe(201);
    expect(db.table("hunts")[0].metadata).toEqual({ preset: "practice", scoring_version: 2 });
  });

  it("lets the creator choose version 1 for a new hunt", async () => {
    const db = installDouble({ hunts: [] });
    await createHunt(req("POST", "/hunts", { title: "New hunt", metadata: { scoring_version: 1 } }));
    expect((db.table("hunts")[0].metadata as Row).scoring_version).toBe(1);
  });

  it("can be changed while the hunt has no play sessions", async () => {
    const db = seedHunt({});
    expect((await put({ scoring_version: 2, scoring_solve_window_min: 120 })).status).toBe(200);
    expect(db.table("hunts")[0].metadata).toMatchObject({ scoring_version: 2, scoring_solve_window_min: 120 });
  });

  it("is locked once the hunt has been played", async () => {
    const db = seedHunt({}, played);
    const res = await put({ scoring_version: 2 });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/scoring is locked/i);
    expect(db.table("hunts")[0].metadata).toEqual({});

    seedHunt({ scoring_version: 2 }, played);
    expect((await put({ scoring_version: 2, scoring_solve_window_min: 30 })).status).toBe(409);
  });

  it("keeps the stored version when a save leaves it out, even on a played hunt", async () => {
    const db = seedHunt({ scoring_version: 2 }, played);
    expect((await put({ hide_scores: true })).status).toBe(200);
    expect(db.table("hunts")[0].metadata).toEqual({ hide_scores: true, scoring_version: 2 });
  });

  it("rejects a version that does not exist", async () => {
    seedHunt({});
    expect((await put({ scoring_version: 3 })).status).toBe(400);
  });
});

describe("GET /api/v1/leaderboard?hunt_id: tiebreak", () => {
  const session = (user: string, total_score: number, total_solve_ms: number | null, completed_at: string): Row => ({
    id: `s-${user}`, hunt_id: HUNT, user_id: user, status: "completed", total_score, total_solve_ms, completed_at, codename: user,
  });
  // b and c share a score: c solved faster. d and e share score and solve time: d finished first.
  const sessions = [
    session("a", 3600, 900_000, ago(50 * MIN)),
    session("b", 3412, 700_000, ago(40 * MIN)),
    session("c", 3412, 650_000, ago(10 * MIN)),
    session("e", 3000, 500_000, ago(20 * MIN)),
    session("d", 3000, 500_000, ago(30 * MIN)),
    session("f", 3000, null, ago(60 * MIN)),
  ];
  const seedBoard = (metadata: Row) =>
    installDouble(
      {
        hunts: [{ id: HUNT, identity_mode: "codename_assigned", created_by: "owner", metadata }],
        play_sessions: sessions,
        users: sessions.map((s) => ({ id: s.user_id, display_name: String(s.user_id), avatar_url: null, role: "adult", profile_visibility: {} })),
      },
      { embeds: { play_sessions: { users: { table: "users", localKey: "user_id" } } } }
    );
  const board = async () => (await leaderboard(req("GET", `/api/v1/leaderboard?hunt_id=${HUNT}`))).json();

  it("orders by score, then lower total solve time, then earlier finish, and ranks version 2 rows apart", async () => {
    h.user = { id: "owner", role: "hunt_creator" };
    seedBoard({ scoring_version: 2 });
    const { entries } = await board();
    expect(entries.map((e: Row) => e.user_id)).toEqual(["a", "c", "b", "d", "e", "f"]);
    expect(entries.map((e: Row) => e.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    // The tiebreak inputs stay on the server.
    expect(entries[0]).not.toHaveProperty("total_solve_ms");
    expect(entries[0]).not.toHaveProperty("completed_at");
  });

  it("places the viewer among players on the same score", async () => {
    h.user = { id: "b", role: "adult" };
    seedBoard({ scoring_version: 2 });
    expect((await board()).me).toEqual({ rank: 3, score: 3412, gap_to_next: 0, tied: false });
    h.user = { id: "c", role: "adult" };
    seedBoard({ scoring_version: 2 });
    expect((await board()).me).toEqual({ rank: 2, score: 3412, gap_to_next: 188, tied: false });
  });

  it("keeps a shared rank for equal scores on a version 1 hunt, in the same fixed order", async () => {
    h.user = { id: "b", role: "adult" };
    seedBoard({});
    const body = await board();
    expect(body.entries.map((e: Row) => e.user_id)).toEqual(["a", "c", "b", "d", "e", "f"]);
    expect(body.entries.map((e: Row) => e.rank)).toEqual([1, 2, 2, 4, 4, 4]);
    expect(body.me).toEqual({ rank: 2, score: 3412, gap_to_next: 188 });
  });
});
