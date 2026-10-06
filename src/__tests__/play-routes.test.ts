import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  updateStreak: vi.fn(),
  evaluateBadges: vi.fn(),
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
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/services/referral", () => ({ awardReferralPoints: async () => {} }));
vi.mock("@/lib/services/privacy-notice", () => ({ recordPrivacyNotice: async () => null }));
vi.mock("@/lib/services/gamification", () => ({
  updateStreak: h.updateStreak,
  evaluateBadges: h.evaluateBadges,
}));

import { POST as arrive } from "@/app/api/v1/play/[huntId]/arrive/route";
import { POST as answer } from "@/app/api/v1/play/[huntId]/answer/route";
import { POST as clueHint } from "@/app/api/v1/play/[huntId]/clue-hint/route";
import { POST as complete } from "@/app/api/v1/play/[huntId]/complete/route";
import { POST as startHunt } from "@/app/api/v1/play/[huntId]/start/route";
import { POST as rate } from "@/app/api/v1/hunts/[id]/rate/route";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const FIND = "find-1";
// ~1.1 km north of the stop: far outside the 50 m radius.
const FAR = { latitude: 40.26, longitude: -111.65 };
const AT_STOP = { latitude: 40.25, longitude: -111.65 };

const EMBEDS = {
  finds: {
    tasks: { table: "tasks", localKey: "task_id" },
    locations: { table: "locations", localKey: "location_id" },
  },
  play_sessions: {
    find_completions: { table: "find_completions", localKey: "id", foreignKey: "play_session_id" },
  },
};

function seed(overrides: Record<string, Row[]> = {}, opts: { unique?: boolean; rpc?: Record<string, (a: Row) => unknown> } = {}): SupabaseDouble {
  return installDouble(
    {
      hunts: [{ id: HUNT, status: "published", identity_mode: "real_name", metadata: {} }],
      play_sessions: [
        { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: new Date().toISOString(), total_score: 0 },
      ],
      locations: [{ id: "loc-1", latitude: 40.25, longitude: -111.65, radius_meters: 50 }],
      tasks: [{ id: "task-1", challenge_type: "short_text", content: { question: "What do you see?", correct_answer: null } }],
      finds: [{ id: FIND, hunt_id: HUNT, task_id: "task-1", location_id: "loc-1", hot_cold_enabled: true, clue_hints: [] }],
      find_completions: [],
      ...overrides,
    },
    {
      embeds: EMBEDS,
      unique: opts.unique ? { find_completions: [["play_session_id", "find_id"]] } : {},
      rpc: opts.rpc,
    }
  );
}

function post(path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const playParams = { params: Promise.resolve({ huntId: HUNT }) };
const arrived = (extra: Row = {}): Row => ({
  id: "comp-1",
  play_session_id: SESSION,
  find_id: FIND,
  arrived_at: new Date().toISOString(),
  completed_at: null,
  hints_used: 0,
  clue_hints_used: 0,
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
  ...extra,
});

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
  h.updateStreak.mockReset().mockResolvedValue({ current: 1, longest: 1, justBroke: false, badgesEarned: [] });
  h.evaluateBadges.mockReset().mockResolvedValue([]);
});

describe("POST /play/[huntId]/arrive", () => {
  it("does not record an arrival for a far-away GPS fix", async () => {
    const db = seed();
    const res = await arrive(post("/arrive", { find_id: FIND, ...FAR }), playParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.arrived).toBe(false);
    expect(body.hot_cold).not.toBeNull();
    expect(db.table("find_completions")).toHaveLength(0);
  });

  it("does not record an arrival when no position is sent and it is not a manual skip", async () => {
    const db = seed();
    const body = await (await arrive(post("/arrive", { find_id: FIND }), playParams)).json();
    expect(body.arrived).toBe(false);
    expect(db.table("find_completions")).toHaveLength(0);
  });

  it("records a manual skip without coordinates and flags it as unverified", async () => {
    const db = seed();
    const res = await arrive(post("/arrive", { find_id: FIND, manual: true }), playParams);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.arrived).toBe(true);
    const [row] = db.table("find_completions");
    expect(row.arrived_at).toBeTruthy();
    expect((row.metadata as Row).arrival_manual).toBe(true);
  });

  it("records a manual skip from far away, keeping the distance", async () => {
    const db = seed();
    const body = await (await arrive(post("/arrive", { find_id: FIND, manual: true, ...FAR }), playParams)).json();
    expect(body.arrived).toBe(true);
    const meta = db.table("find_completions")[0].metadata as Row;
    expect(meta.arrival_manual).toBe(true);
    expect(meta.arrival_distance as number).toBeGreaterThan(1000);
  });

  it("records a GPS arrival inside the radius as verified", async () => {
    const db = seed();
    const res = await arrive(post("/arrive", { find_id: FIND, ...AT_STOP }), playParams);
    expect(res.status).toBe(201);
    expect((db.table("find_completions")[0].metadata as Row).arrival_manual).toBe(false);
  });

  it("is idempotent: a second in-radius fix reuses the row", async () => {
    const db = seed();
    await arrive(post("/arrive", { find_id: FIND, ...AT_STOP }), playParams);
    const body = await (await arrive(post("/arrive", { find_id: FIND, ...AT_STOP }), playParams)).json();
    expect(body.already_arrived).toBe(true);
    expect(db.table("find_completions")).toHaveLength(1);
  });

  it("stamps an existing primer row and keeps its metadata", async () => {
    const db = seed({
      find_completions: [arrived({ arrived_at: null, metadata: { prime_viewed_at: "2026-01-01T00:00:00.000Z" } })],
    });
    const body = await (await arrive(post("/arrive", { find_id: FIND, ...AT_STOP }), playParams)).json();
    expect(body.arrived).toBe(true);
    const [row] = db.table("find_completions");
    expect(row.arrived_at).toBeTruthy();
    expect((row.metadata as Row).prime_viewed_at).toBe("2026-01-01T00:00:00.000Z");
  });

  it("tolerates duplicate completion rows", async () => {
    seed({ find_completions: [arrived(), arrived({ id: "comp-2", created_at: "2026-01-01T00:00:01.000Z" })] });
    const res = await arrive(post("/arrive", { find_id: FIND, ...AT_STOP }), playParams);
    expect(res.status).toBe(200);
    expect((await res.json()).arrived).toBe(true);
  });

  it("omits hot/cold when the stop has it disabled", async () => {
    seed({ finds: [{ id: FIND, hunt_id: HUNT, task_id: "task-1", location_id: "loc-1", hot_cold_enabled: false }] });
    const body = await (await arrive(post("/arrive", { find_id: FIND, ...FAR }), playParams)).json();
    expect(body.hot_cold).toBeNull();
    expect(body.hot_cold_enabled).toBe(false);
  });
});

describe("POST /play/[huntId]/answer", () => {
  it("completes an open-ended stop on the first real answer", async () => {
    const db = seed({ find_completions: [arrived()] });
    const res = await answer(post("/answer", { find_id: FIND, answer: "A red door" }), playParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_complete).toBe(true);
    expect(body.feedback.type).toBe("correct");
    expect(db.table("find_completions")[0].completed_at).toBeTruthy();
    expect(db.table("points_ledger")).toHaveLength(1);
  });

  it("rejects a blank open-ended answer without using an attempt", async () => {
    const db = seed({ find_completions: [arrived()] });
    const res = await answer(post("/answer", { find_id: FIND, answer: "   " }), playParams);
    expect(res.status).toBe(400);
    expect((db.table("find_completions")[0].metadata as Row).attempt_count).toBeUndefined();
  });

  it("grades an ordering challenge against correct_order", async () => {
    const tasks = [{ id: "task-1", challenge_type: "sorting_ordering", content: { items: ["a", "b", "c"], correct_order: ["a", "b", "c"] } }];
    seed({ tasks, find_completions: [arrived()] });
    const wrong = await (await answer(post("/answer", { find_id: FIND, answer: "b,a,c" }), playParams)).json();
    expect(wrong.is_complete).toBe(false);
    expect(wrong.can_retry).toBe(true);
    const right = await (await answer(post("/answer", { find_id: FIND, answer: "a,b,c" }), playParams)).json();
    expect(right.is_complete).toBe(true);
    expect(right.feedback.type).toBe("correct");
  });

  it("accepts a numerically equal answer", async () => {
    const tasks = [{ id: "task-1", challenge_type: "numeric_entry", content: { correct_answer: "5" } }];
    seed({ tasks, find_completions: [arrived()] });
    const body = await (await answer(post("/answer", { find_id: FIND, answer: "5.0" }), playParams)).json();
    expect(body.is_complete).toBe(true);
  });

  it("applies the clue-hint penalty on top of the challenge-hint penalty", async () => {
    seed({ find_completions: [arrived({ clue_hints_used: 2, hints_used: 1 })] });
    const body = await (await answer(post("/answer", { find_id: FIND, answer: "A red door" }), playParams)).json();
    expect(body.breakdown.hintPenalty).toBe(2 * 2 + 1 * 5);

    seed({ find_completions: [arrived()] });
    const clean = await (await answer(post("/answer", { find_id: FIND, answer: "A red door" }), playParams)).json();
    expect(clean.score - body.score).toBe(9);
  });

  it("still works when the stop has duplicate completion rows", async () => {
    const db = seed({
      find_completions: [
        arrived({ arrived_at: null }),
        arrived({ id: "comp-2", created_at: "2026-01-01T00:00:01.000Z" }),
      ],
    });
    const res = await answer(post("/answer", { find_id: FIND, answer: "A red door" }), playParams);
    expect(res.status).toBe(200);
    // The arrived row is the one that gets completed.
    expect(db.where("find_completions", (r) => r.id === "comp-2")[0].completed_at).toBeTruthy();
  });

  it("requires an arrival first", async () => {
    seed({ find_completions: [arrived({ arrived_at: null })] });
    const res = await answer(post("/answer", { find_id: FIND, answer: "x" }), playParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/arrive/i);
  });

  it("updates the streak and evaluates badges when a stop completes", async () => {
    h.updateStreak.mockResolvedValue({ current: 3, longest: 3, justBroke: false, badgesEarned: ["STREAK_3"] });
    h.evaluateBadges.mockResolvedValue(["FIRST_FIND"]);
    seed({ find_completions: [arrived()] });
    const body = await (await answer(post("/answer", { find_id: FIND, answer: "A red door" }), playParams)).json();
    expect(h.updateStreak).toHaveBeenCalledWith("u1");
    expect(h.evaluateBadges).toHaveBeenCalledWith("u1", "find_complete");
    expect(body.badges_earned).toEqual(["STREAK_3", "FIRST_FIND"]);
  });

  it("does not award badges for an attempt that does not complete the stop", async () => {
    const tasks = [{ id: "task-1", challenge_type: "short_text", content: { correct_answer: "oak" } }];
    seed({ tasks, find_completions: [arrived()] });
    const body = await (await answer(post("/answer", { find_id: FIND, answer: "maple" }), playParams)).json();
    expect(body.is_complete).toBe(false);
    expect(h.evaluateBadges).not.toHaveBeenCalled();
  });

  it("still scores the answer when badge evaluation throws", async () => {
    h.evaluateBadges.mockRejectedValue(new Error("badge_types unavailable"));
    seed({ find_completions: [arrived()] });
    const res = await answer(post("/answer", { find_id: FIND, answer: "A red door" }), playParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_complete).toBe(true);
    expect(body.badges_earned).toEqual([]);
  });
});

describe("POST /play/[huntId]/clue-hint", () => {
  const withHints = { finds: [{ id: FIND, hunt_id: HUNT, task_id: "task-1", location_id: "loc-1", clue_hints: ["Look up", "Near the fountain"] }] };

  it("creates the completion row so the penalty reaches scoring", async () => {
    const db = seed(withHints);
    const body = await (await clueHint(post("/clue-hint", { find_id: FIND, level: 1 }), playParams)).json();
    expect(body.hint).toBe("Look up");
    expect(body.total_hints).toBe(2);
    expect(db.table("find_completions")[0].clue_hints_used).toBe(1);
  });

  it("raises the count on an existing row and never lowers it", async () => {
    const db = seed({ ...withHints, find_completions: [arrived({ clue_hints_used: 1 })] });
    await clueHint(post("/clue-hint", { find_id: FIND, level: 2 }), playParams);
    expect(db.table("find_completions")[0].clue_hints_used).toBe(2);
    await clueHint(post("/clue-hint", { find_id: FIND, level: 1 }), playParams);
    expect(db.table("find_completions")[0].clue_hints_used).toBe(2);
  });

  it("returns 404 when the stop has no clue hints", async () => {
    seed();
    const res = await clueHint(post("/clue-hint", { find_id: FIND, level: 1 }), playParams);
    expect(res.status).toBe(404);
  });
});

describe("POST /play/[huntId]/complete", () => {
  it("completes the session and evaluates hunt badges", async () => {
    h.evaluateBadges.mockResolvedValue(["FIRST_HUNT"]);
    const db = seed();
    const res = await complete(post("/complete"), playParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(db.table("play_sessions")[0].status).toBe("completed");
    expect(h.evaluateBadges).toHaveBeenCalledWith("u1", "hunt_complete");
    expect(body.badges_earned).toEqual(["FIRST_HUNT"]);
  });

  it("is idempotent: a repeat call returns the finished session", async () => {
    seed();
    await complete(post("/complete"), playParams);
    h.evaluateBadges.mockClear();
    const res = await complete(post("/complete"), playParams);
    expect(res.status).toBe(200);
    expect((await res.json()).already_completed).toBe(true);
    expect(h.evaluateBadges).not.toHaveBeenCalled();
  });

  it("returns 404 when the player never started the hunt", async () => {
    seed({ play_sessions: [] });
    expect((await complete(post("/complete"), playParams)).status).toBe(404);
  });

  it("still completes when streak tracking throws", async () => {
    h.updateStreak.mockRejectedValue(new Error("streaks unavailable"));
    const db = seed();
    const res = await complete(post("/complete"), playParams);
    expect(res.status).toBe(200);
    expect(db.table("play_sessions")[0].status).toBe("completed");
  });
});

describe("POST /play/[huntId]/start with identity mode codename_chosen", () => {
  const chosen = {
    hunts: [{ id: HUNT, status: "published", identity_mode: "codename_chosen", metadata: {} }],
    play_sessions: [] as Row[],
  };

  it("asks for a codename instead of failing opaquely", async () => {
    const db = seed(chosen);
    const res = await startHunt(post("/start", {}), playParams);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.needs_codename).toBe(true);
    expect(db.table("play_sessions")).toHaveLength(0);
  });

  it("starts with the chosen codename", async () => {
    const db = seed(chosen);
    const res = await startHunt(post("/start", { codename: "  Swift Otter " }), playParams);
    expect(res.status).toBe(201);
    expect(db.table("play_sessions")[0].codename).toBe("Swift Otter");
  });

  it("falls back to an assigned codename on request", async () => {
    const db = seed(chosen, { rpc: { assign_random_codename: () => "Azure Fox" } });
    const res = await startHunt(post("/start", { assign_codename: true }), playParams);
    expect(res.status).toBe(201);
    expect(db.table("play_sessions")[0].codename).toBe("Azure Fox");
  });

  it("rejects a codename another player holds, but lets a replayer reuse their own", async () => {
    const taken = {
      ...chosen,
      play_sessions: [
        { id: "s-other", hunt_id: HUNT, user_id: "u2", status: "active", codename: "Swift Otter" },
        { id: "s-mine", hunt_id: HUNT, user_id: "u1", status: "completed", codename: "Bold Lynx" },
      ],
    };
    seed(taken);
    expect((await startHunt(post("/start", { codename: "Swift Otter" }), playParams)).status).toBe(409);
    seed(taken);
    expect((await startHunt(post("/start", { codename: "Bold Lynx" }), playParams)).status).toBe(201);
  });
});

describe("POST /play/[huntId]/start on team hunts", () => {
  const teamHunt = (extra: Record<string, Row[]> = {}) => ({
    hunts: [{ id: HUNT, status: "published", identity_mode: "real_name", play_mode: "team_self_select", created_by: "owner", metadata: {} }],
    play_sessions: [] as Row[],
    teams: [{ id: "team-1", hunt_id: HUNT, name: "Otters", status: "forming", max_size: 4 }],
    team_members: [] as Row[],
    ...extra,
  });

  it("refuses a player who is not on a team", async () => {
    const db = seed(teamHunt());
    const res = await startHunt(post("/start", {}), playParams);
    expect(res.status).toBe(409);
    expect(db.table("play_sessions")).toHaveLength(0);
  });

  it("attaches the session to the player's own team, ignoring a client-sent team", async () => {
    const db = seed(
      teamHunt({ team_members: [{ id: "m1", team_id: "team-1", user_id: "u1", status: "active", role: "member" }] })
    );
    const res = await startHunt(post("/start", { team_id: "someone-elses-team" }), playParams);
    expect(res.status).toBe(201);
    expect(db.table("play_sessions")[0].team_id).toBe("team-1");
  });

  it("never stores a client-sent team on a solo hunt", async () => {
    const db = seed({ play_sessions: [] });
    const res = await startHunt(post("/start", { team_id: "team-1" }), playParams);
    expect(res.status).toBe(201);
    expect(db.table("play_sessions")[0].team_id).toBeNull();
  });
});

describe("POST /hunts/[id]/rate", () => {
  const rateParams = { params: Promise.resolve({ id: HUNT }) };

  it("lets a replayer with several sessions rate the hunt", async () => {
    const db = seed({
      play_sessions: [
        { id: "s1", hunt_id: HUNT, user_id: "u1", status: "completed" },
        { id: "s2", hunt_id: HUNT, user_id: "u1", status: "completed" },
        { id: "s3", hunt_id: HUNT, user_id: "u1", status: "active" },
      ],
    });
    const res = await rate(post("/rate", { rating: 4 }), rateParams);
    expect(res.status).toBe(200);
    expect(db.table("hunt_ratings")[0].rating).toBe(4);
  });

  it("refuses a rating from someone who has not played", async () => {
    const db = seed({ play_sessions: [] });
    const res = await rate(post("/rate", { rating: 4 }), rateParams);
    expect(res.status).toBe(403);
    expect(db.table("hunt_ratings")).toHaveLength(0);
  });
});
