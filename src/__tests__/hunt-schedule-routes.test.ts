import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Issue #14: multi-day scheduled hunts. The hunt has one window for everyone
 * and releases its stops at set times. The server holds an unreleased stop
 * back completely, lets players join only while the hunt is open, scores the
 * time since release on version 2 hunts, and locks the schedule once the hunt
 * is published or played. Hunts with no window behave exactly as before.
 */

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
vi.mock("@/lib/utils/rate-limit", () => ({
  playLimiter: { check: async () => {} },
  checkInLimiter: { check: async () => {} },
  aiLimiter: { check: async () => {} },
  generalLimiter: { check: async () => {} },
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/utils/track-event", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/utils/run-after", () => ({ runAfter: () => {} }));
vi.mock("@/lib/services/referral", () => ({ awardReferralPoints: async () => {} }));
vi.mock("@/lib/services/privacy-notice", () => ({ recordPrivacyNotice: async () => null }));
vi.mock("@/lib/services/gamification", () => ({
  updateStreak: async () => ({ current: 1, longest: 1, justBroke: false, badgesEarned: [] }),
  evaluateBadges: async () => [],
}));

import { GET as getStops } from "@/app/api/v1/play/[huntId]/stops/route";
import { POST as startHunt } from "@/app/api/v1/play/[huntId]/start/route";
import { POST as startStop } from "@/app/api/v1/play/[huntId]/start-stop/route";
import { POST as arrive } from "@/app/api/v1/play/[huntId]/arrive/route";
import { POST as answer } from "@/app/api/v1/play/[huntId]/answer/route";
import { POST as clueHint } from "@/app/api/v1/play/[huntId]/clue-hint/route";
import { PUT as saveSchedule } from "@/app/api/v1/hunts/[id]/schedule/route";
import { GET as getHunt, PUT as updateHunt } from "@/app/api/v1/hunts/[id]/route";
import { POST as addStop } from "@/app/api/v1/hunts/[id]/finds/route";
import { DELETE as removeStop, PUT as updateStop } from "@/app/api/v1/hunts/[id]/finds/[findId]/route";
import { POST as capture } from "@/app/api/v1/play/[huntId]/capture/route";
import { SCHEDULED_STOPS_LOCKED_MESSAGE } from "@/lib/hunts/delivery-lock";
import { GET as leaderboard } from "@/app/api/v1/leaderboard/route";
import {
  HUNT_ENDED_MESSAGE,
  HUNT_NOT_OPEN_MESSAGE,
  SCHEDULE_LOCKED_MESSAGE,
  STOP_NOT_RELEASED_MESSAGE,
} from "@/lib/hunts/schedule";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const DENVER = "America/Denver";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Monday 23 November 2026, 9:00 in Denver, to Friday 4 December, 21:00.
const STARTS = "2026-11-23T16:00:00.000Z";
const ENDS = "2026-12-05T04:00:00.000Z";
// f0 opens with the hunt, f1 on Tuesday 9:00, f2 on Wednesday 9:00.
const RELEASE = { f0: null, f1: "2026-11-24T16:00:00.000Z", f2: "2026-11-25T16:00:00.000Z" } as const;
const STOPS = ["f0", "f1", "f2"] as const;
const at = (iso: string, plusMs = 0) => Date.parse(iso) + plusMs;

const PLACE = "Centennial Bell Tower";
const SECRETS = [PLACE, "Look for the carillon", "Count the bells", "How many bells?", "Before you go", "40.25", "111.65"];

const EMBEDS = {
  hunts: { finds: { table: "finds", localKey: "id", foreignKey: "hunt_id", many: true } },
  finds: {
    locations: { table: "locations", localKey: "location_id" },
    tasks: { table: "tasks", localKey: "task_id" },
    primers: { table: "primers", localKey: "primer_id" },
  },
};

interface SeedOptions {
  scheduled?: boolean;
  status?: string;
  metadata?: Row;
  sessions?: Row[];
  completions?: Row[];
}

function seed(opts: SeedOptions = {}): SupabaseDouble {
  const scheduled = opts.scheduled ?? true;
  return installDouble(
    {
      hunts: [
        {
          id: HUNT, title: "Two weeks of clues", status: opts.status ?? "published", review_status: "approved",
          identity_mode: "real_name", play_mode: "solo", created_by: "creator", deleted_at: null,
          metadata: { clue_delivery: "all_at_once", schedule_timezone: DENVER, ...(opts.metadata ?? {}) },
          starts_at: scheduled ? STARTS : null,
          ends_at: scheduled ? ENDS : null,
        },
      ],
      play_sessions: opts.sessions ?? [
        { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: STARTS, total_score: 0, metadata: {} },
      ],
      locations: STOPS.map((id) => ({ id: `loc-${id}`, name: PLACE, latitude: 40.25, longitude: -111.65, radius_meters: 50 })),
      tasks: STOPS.map((id) => ({
        id: `task-${id}`, title: "Count the bells", challenge_type: "short_text",
        content: { question: "How many bells?", correct_answer: "52" },
      })),
      primers: STOPS.map((id) => ({ id: `primer-${id}`, title: "Before you go", content: { body: "Bring a coat" } })),
      finds: STOPS.map((id, i) => ({
        id, hunt_id: HUNT, sort_order: i, deleted_at: null, clue_text: "Look for the carillon", clue_hints: ["It rings"],
        hot_cold_enabled: true, location_id: `loc-${id}`, task_id: `task-${id}`, primer_id: `primer-${id}`,
        release_at: scheduled ? RELEASE[id] : null,
      })),
      find_completions: opts.completions ?? [],
      user_profiles: [],
      hunt_clue_orders: [],
      points_ledger: [],
    },
    { embeds: EMBEDS, unique: { find_completions: [["play_session_id", "find_id"]] } }
  );
}

const completion = (findId: string, extra: Row = {}): Row => ({
  id: `c-${findId}`, play_session_id: SESSION, find_id: findId, started_at: null, arrived_at: null, completed_at: null,
  hints_used: 0, clue_hints_used: 0, metadata: {}, created_at: STARTS, ...extra,
});

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const playParams = { params: Promise.resolve({ huntId: HUNT }) };
const huntParams = { params: Promise.resolve({ id: HUNT }) };
const stops = async () => (await getStops(req("GET", "/stops"), playParams)).json();
const begin = (findId: string) => startStop(req("POST", "/start-stop", { find_id: findId }), playParams);
const now = (ms: number) => vi.setSystemTime(ms);

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
  vi.useFakeTimers({ toFake: ["Date"] });
  now(at(STARTS, HOUR));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /play/[huntId]/stops on a scheduled hunt", () => {
  it("an hour in: the first stop is open, the others say when they open and nothing else", async () => {
    seed();
    const body = await stops();
    expect(body.stops.map((s: Row) => s.open)).toEqual([true, false, false]);
    expect(body.stops[0].release_at).toBeUndefined();
    expect(body.stops[1].release_at).toBe(RELEASE.f1);
    expect(body.stops[2].release_at).toBe(RELEASE.f2);
    // The open stop has its primer; a stop that is not out has not even that.
    expect(body.stops[0].primers).toMatchObject({ title: "Before you go" });
    for (const held of body.stops.slice(1)) {
      expect(held).toMatchObject({ clue_text: null, locations: null, tasks: null, primers: null, started_at: null });
      const text = JSON.stringify(held);
      for (const secret of SECRETS) expect(text).not.toContain(secret);
    }
  });

  it("reports the window, the phase and the next release, on the server's clock", async () => {
    seed();
    expect((await stops()).schedule).toEqual({
      starts_at: STARTS,
      ends_at: ENDS,
      phase: "open",
      next_release_at: RELEASE.f1,
      server_time: new Date(at(STARTS, HOUR)).toISOString(),
    });
  });

  it("opens each stop at its own time", async () => {
    seed();
    now(at(RELEASE.f1) - 1);
    expect((await stops()).stops.map((s: Row) => s.open)).toEqual([true, false, false]);
    now(at(RELEASE.f1));
    const tuesday = await stops();
    expect(tuesday.stops.map((s: Row) => s.open)).toEqual([true, true, false]);
    expect(tuesday.schedule.next_release_at).toBe(RELEASE.f2);
    now(at(RELEASE.f2));
    const wednesday = await stops();
    expect(wednesday.stops.map((s: Row) => s.open)).toEqual([true, true, true]);
    expect(wednesday.schedule.next_release_at).toBeNull();
  });

  it("someone who joins late gets every stop released so far", async () => {
    seed({ sessions: [{ id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: "2026-12-01T16:00:00.000Z", metadata: {} }] });
    now(at("2026-12-01T16:00:00.000Z"));
    expect((await stops()).stops.map((s: Row) => s.open)).toEqual([true, true, true]);
  });

  it("after the end nothing can be started, and stops already started stay readable", async () => {
    seed({ completions: [completion("f0", { started_at: STARTS })] });
    now(at(ENDS));
    const body = await stops();
    expect(body.schedule.phase).toBe("ended");
    expect(body.stops[0].clue_text).toBe("Look for the carillon");
    expect(body.stops.slice(1).map((s: Row) => s.open)).toEqual([false, false]);
  });

  it("a hunt with no window has no schedule and holds nothing back", async () => {
    seed({ scheduled: false });
    const body = await stops();
    expect(body.schedule).toBeNull();
    expect(body.stops.map((s: Row) => s.open)).toEqual([true, true, true]);
    for (const stop of body.stops) expect(stop.release_at).toBeUndefined();
  });
});

describe("a stop that has not been released", () => {
  const calls: Array<[string, () => Promise<Response>]> = [
    ["start-stop", () => begin("f1")],
    ["arrive", () => arrive(req("POST", "/arrive", { find_id: "f1", latitude: 40.25, longitude: -111.65, accuracy: 5, manual: true }), playParams)],
    ["answer", () => answer(req("POST", "/answer", { find_id: "f1", answer: "52" }), playParams)],
    ["clue-hint", () => clueHint(req("POST", "/clue-hint", { find_id: "f1", level: 1 }), playParams)],
  ];

  it.each(calls)("%s is refused, with nothing about the stop in the reply and nothing recorded", async (_name, call) => {
    const db = seed();
    const res = await call();
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe(STOP_NOT_RELEASED_MESSAGE);
    const text = JSON.stringify(body);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(db.table("find_completions")).toHaveLength(0);
  });

  it("can be started the moment it is released", async () => {
    seed();
    now(at(RELEASE.f1));
    const res = await begin("f1");
    expect(res.status).toBe(201);
    expect((await res.json()).stop.clue_text).toBe("Look for the carillon");
  });
});

describe("POST /play/[huntId]/start: joining a scheduled hunt", () => {
  const join = () => startHunt(req("POST", "/start", {}), playParams);

  it("is refused before the hunt starts, and says when it does in the hunt's own time zone", async () => {
    const db = seed({ sessions: [] });
    now(at(STARTS) - 1);
    const res = await join();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This hunt starts Mon, Nov 23, 9:00 AM. Come back then to play.");
    expect(db.table("play_sessions")).toHaveLength(0);
  });

  it("is allowed at any point while the hunt is open", async () => {
    for (const moment of [at(STARTS), at(STARTS, 8 * DAY), at(ENDS) - 1]) {
      const db = seed({ sessions: [] });
      now(moment);
      expect((await join()).status).toBe(201);
      expect(db.table("play_sessions")).toHaveLength(1);
    }
  });

  it("is refused once the hunt has ended", async () => {
    const db = seed({ sessions: [] });
    now(at(ENDS));
    const res = await join();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(HUNT_ENDED_MESSAGE);
    expect(db.table("play_sessions")).toHaveLength(0);
  });

  it("a player who already joined can always get back into their session", async () => {
    seed();
    now(at(ENDS, DAY));
    const res = await join();
    expect(res.status).toBe(200);
    expect((await res.json()).resumed).toBe(true);
  });

  it("a hunt with no window can be started at any time", async () => {
    seed({ scheduled: false, sessions: [] });
    now(at("2031-01-01T00:00:00.000Z"));
    expect((await join()).status).toBe(201);
  });
});

describe("outside the hunt's window", () => {
  it("no stop can be started before the hunt starts, even with a session", async () => {
    seed();
    now(at(STARTS) - 1);
    const res = await begin("f0");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(HUNT_NOT_OPEN_MESSAGE);
  });

  it("no answer counts after the hunt has ended", async () => {
    const db = seed({ completions: [completion("f0", { started_at: STARTS, arrived_at: STARTS })] });
    now(at(ENDS));
    const res = await answer(req("POST", "/answer", { find_id: "f0", answer: "52" }), playParams);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(HUNT_ENDED_MESSAGE);
    expect(db.table("find_completions")[0].completed_at).toBeNull();
  });

  it("a stop finished during the hunt can still be opened afterwards", async () => {
    seed({ completions: [completion("f0", { started_at: STARTS, arrived_at: STARTS, completed_at: STARTS })] });
    now(at(ENDS, DAY));
    const res = await begin("f0");
    expect(res.status).toBe(200);
    expect((await res.json()).stop.locations.name).toBe(PLACE);
  });
});

describe("scoring on a scheduled hunt (version 2)", () => {
  const solve = async (answeredAt: number, startedAt: number) => {
    const startIso = new Date(startedAt).toISOString();
    const db = seed({
      metadata: { scoring_version: 2 },
      completions: [completion("f1", { started_at: startIso, arrived_at: startIso, created_at: startIso })],
    });
    now(answeredAt);
    const res = await answer(req("POST", "/answer", { find_id: "f1", answer: "52" }), playParams);
    return { body: await res.json(), row: db.table("find_completions")[0] };
  };

  it("splits the time points between solve time and time since the stop's release", async () => {
    // Started at the release, answered 5 minutes later.
    const { body, row } = await solve(at(RELEASE.f1, 5 * 60_000), at(RELEASE.f1));
    expect(body.is_complete).toBe(true);
    expect(body.breakdown.releaseTime).toBeGreaterThan(0);
    expect(body.breakdown.solveTime).toBeLessThanOrEqual(150);
    expect(body.breakdown.releaseTime).toBeLessThanOrEqual(150);
    const timing = (row.metadata as Row).scoring_timing as Row;
    expect(timing).toMatchObject({ release_active: true, released_at: RELEASE.f1, release_ms: 5 * 60_000 });
  });

  it("a player who solves it days after release keeps the solve points and loses the release points", async () => {
    const prompt = await solve(at(RELEASE.f1, 5 * 60_000), at(RELEASE.f1));
    const late = await solve(at(RELEASE.f1, 3 * DAY + 5 * 60_000), at(RELEASE.f1, 3 * DAY));
    expect(late.body.breakdown.solveTime).toBe(prompt.body.breakdown.solveTime);
    expect(late.body.breakdown.releaseTime).toBe(0);
    expect(late.body.score).toBeLessThan(prompt.body.score);
    // Correctness and the rest are untouched: they still compete.
    expect(late.body.breakdown.correctness).toBe(prompt.body.breakdown.correctness);
  });

  it("a stop with no time of its own is measured from the hunt's start", async () => {
    const startIso = new Date(at(STARTS, HOUR)).toISOString();
    const db = seed({
      metadata: { scoring_version: 2 },
      completions: [completion("f0", { started_at: startIso, arrived_at: startIso, created_at: startIso })],
    });
    now(at(STARTS, HOUR + 60_000));
    await answer(req("POST", "/answer", { find_id: "f0", answer: "52" }), playParams);
    const timing = (db.table("find_completions")[0].metadata as Row).scoring_timing as Row;
    expect(timing).toMatchObject({ release_active: true, released_at: STARTS, release_ms: HOUR + 60_000 });
  });

  it("a hunt with no window scores on solve time alone, as before", async () => {
    const startIso = new Date(at(STARTS)).toISOString();
    const db = seed({
      scheduled: false,
      metadata: { scoring_version: 2 },
      completions: [completion("f1", { started_at: startIso, arrived_at: startIso, created_at: startIso })],
    });
    now(at(STARTS, 5 * 60_000));
    const res = await answer(req("POST", "/answer", { find_id: "f1", answer: "52" }), playParams);
    const body = await res.json();
    expect(body.breakdown).toMatchObject({ solveTime: 191, releaseTime: 0 });
    const timing = (db.table("find_completions")[0].metadata as Row).scoring_timing as Row;
    expect(timing).toMatchObject({ release_active: false, released_at: null });
  });
});

describe("PUT /hunts/[id]/schedule", () => {
  const schedule = {
    starts_at: STARTS,
    ends_at: ENDS,
    timezone: DENVER,
    releases: [
      { find_id: "f0", release_at: null },
      { find_id: "f1", release_at: RELEASE.f1 },
      { find_id: "f2", release_at: RELEASE.f2 },
    ],
  };
  const put = (body: unknown) => saveSchedule(req("PUT", `/hunts/${HUNT}/schedule`, body), huntParams);
  const draft = (extra: SeedOptions = {}) => seed({ scheduled: false, status: "draft", sessions: [], ...extra });

  beforeEach(() => {
    h.user = { id: "creator", role: "teacher" };
    now(at("2026-11-19T12:00:00.000Z"));
  });

  it("saves the window, the zone and each stop's release on a draft nobody has played", async () => {
    const db = draft({ metadata: { clue_delivery: "random_order", shuffle_stops: true, hide_scores: true } });
    const res = await put(schedule);
    expect(res.status).toBe(200);
    const hunt = db.table("hunts")[0];
    expect(hunt).toMatchObject({ starts_at: STARTS, ends_at: ENDS });
    expect(db.table("finds").map((f) => f.release_at)).toEqual([null, RELEASE.f1, RELEASE.f2]);
    // The zone is kept, other settings are untouched, and every released clue is open at once.
    expect(hunt.metadata).toMatchObject({
      schedule_timezone: DENVER, hide_scores: true, clue_delivery: "all_at_once", shuffle_stops: false,
    });
    expect((await res.json()).schedule).toMatchObject({ starts_at: STARTS, ends_at: ENDS, timezone: DENVER });
  });

  it("admins and researchers can schedule someone else's hunt; nobody else can", async () => {
    for (const user of [{ id: "adm", role: "admin" }, { id: "res", role: "researcher" }]) {
      h.user = user;
      draft();
      expect((await put(schedule)).status).toBe(200);
    }
    for (const user of [{ id: "t2", role: "teacher" }, { id: "u1", role: "adult" }, null]) {
      h.user = user;
      const db = draft();
      expect([401, 403]).toContain((await put(schedule)).status);
      expect(db.table("hunts")[0].starts_at).toBeNull();
    }
  });

  it("is locked once the hunt is published or has been played", async () => {
    for (const opts of [{ status: "published", sessions: [] }, { status: "draft" }] as SeedOptions[]) {
      const db = seed({ scheduled: false, ...opts });
      const res = await put(schedule);
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe(SCHEDULE_LOCKED_MESSAGE);
      expect(db.table("hunts")[0].starts_at).toBeNull();
      expect(db.table("finds").every((f) => f.release_at === null)).toBe(true);
    }
  });

  it("rejects a schedule that can't work, and saves none of it", async () => {
    const bad: Array<[Row, RegExp]> = [
      [{ ...schedule, ends_at: STARTS }, /end after it starts/],
      [{ ...schedule, timezone: "Nowhere/Land" }, /time zone/],
      [{ ...schedule, releases: schedule.releases.slice(0, 2) }, /every stop/],
      [{ ...schedule, releases: [...schedule.releases.slice(0, 2), { find_id: "f2", release_at: ENDS }] }, /before the hunt ends/],
      [{ ...schedule, releases: [...schedule.releases.slice(0, 2), { find_id: "elsewhere", release_at: null }] }, /not in this hunt/],
      [{ ...schedule, releases: "all at nine" }, /list/],
      [{ ...schedule, starts_at: "2031-11-23T16:00:00.000Z", ends_at: "2031-12-05T04:00:00.000Z", releases: schedule.releases.map((r) => ({ ...r, release_at: null })) }, /two years/],
      [{ ...schedule, starts_at: "2026-11-01T16:00:00.000Z", ends_at: "2026-11-10T16:00:00.000Z", releases: schedule.releases.map((r) => ({ ...r, release_at: null })) }, /already passed/],
    ];
    for (const [body, message] of bad) {
      const db = draft();
      const res = await put(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(message);
      expect(db.table("hunts")[0].starts_at).toBeNull();
      expect(db.table("finds").every((f) => f.release_at === null)).toBe(true);
    }
  });

  it("clear makes it a play-anytime hunt again", async () => {
    const db = seed({ status: "draft", sessions: [], metadata: { hide_scores: true } });
    const res = await put({ clear: true });
    expect(res.status).toBe(200);
    expect(db.table("hunts")[0]).toMatchObject({ starts_at: null, ends_at: null });
    expect(db.table("finds").every((f) => f.release_at === null)).toBe(true);
    const metadata = db.table("hunts")[0].metadata as Row;
    expect(metadata.schedule_timezone).toBeUndefined();
    expect(metadata.hide_scores).toBe(true);
  });

  it("a scheduled hunt can't be switched to an order that could land a player on a stop that isn't out", async () => {
    const db = seed({ status: "draft", sessions: [] });
    const change = (clue_delivery: string) =>
      updateHunt(req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery, schedule_timezone: DENVER } }), huntParams);
    for (const mode of ["random_order", "fixed_order"]) {
      const res = await change(mode);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/every released clue at once/);
    }
    expect((db.table("hunts")[0].metadata as Row).clue_delivery).toBe("all_at_once");
    // Other settings still save.
    expect((await updateHunt(req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery: "all_at_once", hide_scores: true } }), huntParams)).status).toBe(200);
  });
});

describe("a scheduled hunt's stops once it is published or played", () => {
  const stopParams = (findId: string) => ({ params: Promise.resolve({ id: HUNT, findId }) });
  const add = () => addStop(req("POST", `/hunts/${HUNT}/finds`, { clue_text: "A new clue" }), huntParams);
  const remove = (findId: string) => removeStop(req("DELETE", `/hunts/${HUNT}/finds/${findId}`), stopParams(findId));
  const move = (findId: string, sort_order: number) =>
    updateStop(req("PUT", `/hunts/${HUNT}/finds/${findId}`, { sort_order }), stopParams(findId));

  beforeEach(() => {
    h.user = { id: "creator", role: "teacher" };
  });

  it("can't be added, removed or reordered: a new stop would have no release time and open at once", async () => {
    for (const opts of [{ status: "published", sessions: [] }, { status: "draft" }] as SeedOptions[]) {
      const db = seed(opts);
      for (const res of [await add(), await remove("f2"), await move("f2", 0)]) {
        expect(res.status).toBe(409);
        expect((await res.json()).error).toBe(SCHEDULED_STOPS_LOCKED_MESSAGE);
      }
      expect(db.table("finds")).toHaveLength(3);
      expect(db.table("finds").every((f) => f.deleted_at === null)).toBe(true);
    }
  });

  it("can still have their wording edited", async () => {
    seed();
    const res = await updateStop(req("PUT", `/hunts/${HUNT}/finds/f2`, { clue_text: "A clearer clue" }), stopParams("f2"));
    expect(res.status).toBe(200);
  });

  it("the editor is told the stops are frozen", async () => {
    seed();
    const body = await (await getHunt(req("GET", `/hunts/${HUNT}`), huntParams)).json();
    expect(body.hunt.stops_frozen).toBe(true);
    seed({ scheduled: false });
    expect((await (await getHunt(req("GET", `/hunts/${HUNT}`), huntParams)).json()).hunt.stops_frozen).toBe(false);
  });

  it("stay editable on a scheduled draft nobody has played, and on hunts with no schedule", async () => {
    seed({ status: "draft", sessions: [] });
    expect((await remove("f2")).status).not.toBe(409);
    seed({ scheduled: false });
    expect((await remove("f2")).status).not.toBe(409);
  });
});

describe("uploads follow the hunt's window", () => {
  const photo = (findId: string) => {
    const form = new FormData();
    form.append("find_id", findId);
    form.append("file", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
    return capture(new NextRequest("http://localhost:3000/x", { method: "POST", body: form }), playParams);
  };

  it("no photo for an unfinished stop once the hunt has ended", async () => {
    seed({ completions: [completion("f0", { started_at: STARTS, arrived_at: STARTS })] });
    now(at(ENDS));
    const res = await photo("f0");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(HUNT_ENDED_MESSAGE);
  });

  it("none for a stop that is not released", async () => {
    seed({ completions: [completion("f1", { started_at: STARTS, arrived_at: STARTS })] });
    const res = await photo("f1");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(STOP_NOT_RELEASED_MESSAGE);
  });
});

describe("GET /leaderboard?hunt_id on a scheduled hunt", () => {
  const session = (user: string, status: string, total_score: number): Row => ({
    id: `s-${user}`, hunt_id: HUNT, user_id: user, status, total_score, total_solve_ms: null,
    completed_at: status === "completed" ? STARTS : null, codename: user,
  });
  const sessions = [session("a", "active", 2600), session("b", "completed", 2100), session("c", "active", 900)];
  const seedBoard = (scheduled: boolean) =>
    installDouble(
      {
        hunts: [{ id: HUNT, identity_mode: "codename_assigned", created_by: "owner", metadata: {}, starts_at: scheduled ? STARTS : null, ends_at: scheduled ? ENDS : null }],
        play_sessions: sessions,
        users: sessions.map((s) => ({ id: s.user_id, display_name: String(s.user_id), avatar_url: null, role: "adult", profile_visibility: {} })),
      },
      { embeds: { play_sessions: { users: { table: "users", localKey: "user_id" } } } }
    );
  const board = async () => (await leaderboard(req("GET", `/api/v1/leaderboard?hunt_id=${HUNT}`))).json();

  it("is a running total: players still in the hunt are listed with what they have so far", async () => {
    h.user = { id: "c", role: "adult" };
    seedBoard(true);
    const body = await board();
    expect(body.entries.map((e: Row) => e.user_id)).toEqual(["a", "b", "c"]);
    expect(body.me).toMatchObject({ rank: 3, score: 900 });
  });

  it("lists a player once they have points, and once: not on pressing Start, and not twice for a replay", async () => {
    h.user = { id: "owner", role: "hunt_creator" };
    const db = seedBoard(true);
    db.table("play_sessions").push(
      { id: "s-new", hunt_id: HUNT, user_id: "d", status: "active", total_score: 0, total_solve_ms: null, completed_at: null, codename: "d" },
      // b finished with 2100 and is replaying, on 300 so far.
      { id: "s-b2", hunt_id: HUNT, user_id: "b", status: "active", total_score: 300, total_solve_ms: null, completed_at: null, codename: "b" }
    );
    db.table("users").push({ id: "d", display_name: "d", avatar_url: null, role: "adult", profile_visibility: {} });
    const body = await board();
    expect(body.entries.map((e: Row) => e.user_id)).toEqual(["a", "b", "c"]);
    expect(body.entries.map((e: Row) => e.score)).toEqual([2600, 2100, 900]);
  });

  it("a hunt with no window still lists finished sessions only", async () => {
    h.user = { id: "c", role: "adult" };
    seedBoard(false);
    const body = await board();
    expect(body.entries.map((e: Row) => e.user_id)).toEqual(["b"]);
    expect(body.me).toBeNull();
  });
});
