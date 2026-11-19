import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Issue #16: nothing that reveals where a stop is leaves the server until the
 * player has started that stop ("I'm ready"), and the start is timed once on
 * the server (find_completions.started_at, migration 084).
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
vi.mock("@/lib/services/findbot", () => ({ generateHint: async () => "An AI hint about the bell tower" }));

import { GET as getStops } from "@/app/api/v1/play/[huntId]/stops/route";
import { POST as startStop } from "@/app/api/v1/play/[huntId]/start-stop/route";
import { POST as primeViewed } from "@/app/api/v1/play/[huntId]/prime-viewed/route";
import { POST as arrive } from "@/app/api/v1/play/[huntId]/arrive/route";
import { POST as arrivePhoto } from "@/app/api/v1/play/[huntId]/arrive-photo/route";
import { POST as clueHint } from "@/app/api/v1/play/[huntId]/clue-hint/route";
import { POST as challengeHint } from "@/app/api/v1/play/[huntId]/hint/route";
import { POST as aiHint } from "@/app/api/v1/ai/hints/route";
import { GET as huntFinds } from "@/app/api/v1/hunts/[id]/finds/route";
import { GET as listLocations } from "@/app/api/v1/locations/route";
import { GET as getLocation } from "@/app/api/v1/locations/[id]/route";
import { getCompletion } from "@/app/api/v1/play/_lib/completions";
import { stopStartedAt } from "@/app/api/v1/play/_lib/stop-start";
import { findsForViewer } from "@/app/api/v1/hunts/redact-finds";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const STOPS = ["f0", "f1", "f2"];
const AT_STOP = { latitude: 40.25, longitude: -111.65 };

/** Every string below must stay on the server until the stop is started. */
const SECRETS = {
  clue: "Look for the carillon",
  hint: "It rings on the hour",
  place: "Centennial Bell Tower",
  address: "900 Campus Drive",
  description: "A tall brick tower",
  task: "Count the bells",
  question: "How many bells hang in the tower?",
  safety: "Mind the cyclists",
  lat: "40.25",
  lng: "-111.65",
};

const EMBEDS = {
  finds: {
    locations: { table: "locations", localKey: "location_id" },
    tasks: { table: "tasks", localKey: "task_id" },
    primers: { table: "primers", localKey: "primer_id" },
  },
};

interface SeedOptions {
  metadata?: Row;
  completions?: Row[];
  sessions?: Row[];
  /** Give every stop a primer (default) or none. */
  primers?: boolean;
}

function seed(opts: SeedOptions = {}): SupabaseDouble {
  const withPrimers = opts.primers !== false;
  return installDouble(
    {
      hunts: [
        {
          id: HUNT, title: "Hunt", status: "published", review_status: "approved", identity_mode: "real_name",
          play_mode: "solo", created_by: "creator", deleted_at: null, metadata: opts.metadata ?? { clue_delivery: "fixed_order" },
        },
      ],
      play_sessions: opts.sessions ?? [
        { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: "2026-11-18T10:00:00.000Z", metadata: {} },
      ],
      locations: STOPS.map((id) => ({
        id: `loc-${id}`, name: SECRETS.place, description: SECRETS.description, address: SECRETS.address,
        latitude: 40.25, longitude: -111.65, radius_meters: 50, safety_notes: SECRETS.safety,
      })),
      tasks: STOPS.map((id) => ({
        id: `task-${id}`, title: SECRETS.task, challenge_type: "numeric_entry",
        content: { question: SECRETS.question, correct_answer: "52", hints: ["Use your ears"] },
      })),
      primers: STOPS.map((id) => ({ id: `primer-${id}`, title: "Before you start", content: { text: "Bells are tuned by size." } })),
      finds: STOPS.map((id, i) => ({
        id, hunt_id: HUNT, sort_order: i, deleted_at: null, clue_text: SECRETS.clue, clue_hints: [SECRETS.hint],
        hot_cold_enabled: true, scaffolding_level: "medium",
        reading_check: { enabled: true, questions: [{ question: "What sets a bell's note?", options: ["Size", "Colour"], correct_answer: "Size" }] },
        location_id: `loc-${id}`, task_id: `task-${id}`, primer_id: withPrimers ? `primer-${id}` : null,
      })),
      find_completions: opts.completions ?? [],
      find_photos: [],
      user_profiles: [],
      ai_hint_cache: [],
      hunt_clue_orders: [],
    },
    { embeds: EMBEDS, unique: { find_completions: [["play_session_id", "find_id"]] }, rpc: { increment_hint_usage: () => null } }
  );
}

const completion = (findId: string, extra: Row = {}): Row => ({
  id: `c-${findId}`,
  play_session_id: SESSION,
  find_id: findId,
  started_at: null,
  arrived_at: null,
  completed_at: null,
  hints_used: 0,
  clue_hints_used: 0,
  metadata: {},
  created_at: "2026-11-18T10:01:00.000Z",
  ...extra,
});

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const playParams = { params: Promise.resolve({ huntId: HUNT }) };
const stops = () => getStops(req("GET", "/stops"), playParams);
const start = (findId: unknown) => startStop(req("POST", "/start-stop", { find_id: findId }), playParams);

function expectNoSecrets(payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const [name, secret] of Object.entries(SECRETS)) {
    expect(text, `${name} must not be in the response`).not.toContain(secret);
  }
  expect(text).not.toContain("correct_answer");
}

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
});

describe("GET /play/[huntId]/stops", () => {
  it("returns no location-revealing fields for a stop that has not been started", async () => {
    seed();
    const res = await stops();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.stops.map((s: Row) => s.id)).toEqual(STOPS);
    expectNoSecrets(body);
    expect(body.stops[0]).toEqual({
      id: "f0",
      sort_order: 0,
      started_at: null,
      open: true,
      clue_text: null,
      hot_cold_enabled: null,
      scaffolding_level: null,
      reading_check: null,
      locations: null,
      tasks: null,
      // The primer is the "before you start" reading, so it comes first.
      primers: { title: "Before you start", content: { text: "Bells are tuned by size." } },
    });
  });

  it("holds back even the primer of a stop the clue order has not opened yet", async () => {
    seed();
    const body = await (await stops()).json();
    expect(body.stops[1]).toMatchObject({ id: "f1", started_at: null, open: false, primers: null });
    expect(body.stops[2]).toMatchObject({ id: "f2", started_at: null, open: false, primers: null });
  });

  it("all_at_once: every stop is open to start, and still shows nothing until it is", async () => {
    seed({ metadata: { clue_delivery: "all_at_once" } });
    const body = await (await stops()).json();
    expectNoSecrets(body);
    expect(body.stops.every((s: Row) => s.open === true && s.started_at === null && s.primers !== null)).toBe(true);
  });

  it("releases a stop's details once that stop is started, and only that stop's", async () => {
    seed({ completions: [completion("f0", { started_at: "2026-11-18T10:05:00.000Z" })] });
    const body = await (await stops()).json();
    expect(body.stops[0]).toMatchObject({
      id: "f0",
      started_at: "2026-11-18T10:05:00.000Z",
      open: true,
      clue_text: SECRETS.clue,
      hot_cold_enabled: true,
      locations: { name: SECRETS.place, latitude: 40.25, longitude: -111.65, radius_meters: 50, safety_notes: SECRETS.safety },
      tasks: { title: SECRETS.task, challenge_type: "numeric_entry" },
    });
    expectNoSecrets(body.stops.slice(1));
  });

  it("never sends answer keys, the clue hint list or the address, even for a started stop", async () => {
    seed({ completions: [completion("f0", { started_at: "2026-11-18T10:05:00.000Z" })] });
    const text = JSON.stringify(await (await stops()).json());
    expect(text).not.toContain('"correct_answer":"52"');
    expect(text).not.toContain(SECRETS.hint);
    expect(text).not.toContain(SECRETS.address);
    expect(text).not.toContain("clue_hints");
  });

  it("in-progress session: a stop already arrived at counts as started (no started_at yet)", async () => {
    seed({ completions: [completion("f0", { arrived_at: "2026-11-18T10:07:00.000Z" })] });
    const body = await (await stops()).json();
    expect(body.stops[0]).toMatchObject({ started_at: "2026-11-18T10:07:00.000Z", clue_text: SECRETS.clue });
    expect(body.stops[0].locations).not.toBeNull();
  });

  it("in-progress session: a finished stop keeps its details and the next stop opens", async () => {
    seed({
      completions: [completion("f0", { arrived_at: "2026-11-18T10:07:00.000Z", completed_at: "2026-11-18T10:09:00.000Z" })],
    });
    const body = await (await stops()).json();
    expect(body.stops[0].clue_text).toBe(SECRETS.clue);
    expect(body.stops[1]).toMatchObject({ open: true, started_at: null, clue_text: null, locations: null });
    expect(body.stops[1].primers).not.toBeNull();
  });

  it("follows the session's shuffled order", async () => {
    seed({ metadata: { clue_delivery: "random_order" } });
    const body = await (await stops()).json();
    const ids = body.stops.map((s: Row) => s.id);
    expect([...ids].sort()).toEqual(STOPS);
    // Only the first stop in this session's order is open.
    expect(body.stops.map((s: Row) => s.open)).toEqual([true, false, false]);
    // The same order the start route's check uses.
    expect((await start(ids[0])).status).toBe(201);
    expect((await start(ids[1])).status).toBe(409);
  });

  it("needs a signed-in player with an active session in this hunt", async () => {
    seed();
    h.user = null;
    expect((await stops()).status).toBe(401);
    // Another player's session is never used.
    h.user = { id: "u2", role: "adult" };
    expect((await stops()).status).toBe(404);
    seed({ sessions: [{ id: SESSION, hunt_id: HUNT, user_id: "u1", status: "completed", metadata: {} }] });
    h.user = { id: "u1", role: "adult" };
    expect((await stops()).status).toBe(404);
  });
});

describe("POST /play/[huntId]/start-stop", () => {
  it("starts the stop: records the start time and hands over the details", async () => {
    const db = seed();
    const before = Date.now();
    const res = await start("f0");
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.already_started).toBe(false);
    const [row] = db.table("find_completions");
    expect(row).toMatchObject({ play_session_id: SESSION, find_id: "f0" });
    expect(row.arrived_at ?? null).toBeNull();
    expect(Date.parse(row.started_at as string)).toBeGreaterThanOrEqual(before);
    expect(body.started_at).toBe(row.started_at);
    expect(body.completion_id).toBe(row.id);
    expect(body.stop).toMatchObject({
      id: "f0",
      started_at: row.started_at,
      clue_text: SECRETS.clue,
      locations: { name: SECRETS.place, latitude: 40.25, longitude: -111.65 },
    });
    expect(JSON.stringify(body)).not.toContain('"correct_answer":"52"');
  });

  it("is idempotent: a reload or retry never restarts the clock", async () => {
    const db = seed();
    const first = await (await start("f0")).json();
    const stored = db.table("find_completions")[0].started_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const again = await start("f0");
    const body = await again.json();
    expect(again.status).toBe(200);
    expect(body.already_started).toBe(true);
    expect(body.started_at).toBe(first.started_at);
    expect(body.stop.clue_text).toBe(SECRETS.clue);
    expect(db.table("find_completions")).toHaveLength(1);
    expect(db.table("find_completions")[0].started_at).toBe(stored);
  });

  it("keeps an earlier start time that is already stored", async () => {
    const db = seed({ completions: [completion("f0", { started_at: "2026-11-18T10:05:00.000Z" })] });
    const body = await (await start("f0")).json();
    expect(body).toMatchObject({ already_started: true, started_at: "2026-11-18T10:05:00.000Z" });
    expect(db.table("find_completions")[0].started_at).toBe("2026-11-18T10:05:00.000Z");
  });

  it("in-progress session: a stop already arrived at is not restarted", async () => {
    const db = seed({ completions: [completion("f0", { arrived_at: "2026-11-18T10:07:00.000Z" })] });
    const res = await start("f0");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ already_started: true, started_at: "2026-11-18T10:07:00.000Z" });
    expect(db.table("find_completions")[0].arrived_at).toBe("2026-11-18T10:07:00.000Z");
  });

  it("records that the primer was read when the stop has one", async () => {
    const db = seed();
    await start("f0");
    const withPrimer = db.table("find_completions")[0];
    expect((withPrimer.metadata as Row).prime_viewed_at).toBe(withPrimer.started_at);

    const bare = seed({ primers: false });
    await start("f0");
    expect((bare.table("find_completions")[0].metadata as Row).prime_viewed_at).toBeUndefined();
  });

  it("refuses a stop the player's clue order has not reached, and reveals nothing", async () => {
    const db = seed();
    const res = await start("f1");
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/isn't open yet/);
    expectNoSecrets(body);
    expect(db.table("find_completions")).toHaveLength(0);
  });

  it("opens the next stop once the current one is finished", async () => {
    seed({ completions: [completion("f0", { arrived_at: "2026-11-18T10:07:00.000Z", completed_at: "2026-11-18T10:09:00.000Z" })] });
    expect((await start("f1")).status).toBe(201);
    expect((await start("f2")).status).toBe(409);
  });

  it("all_at_once: any stop can be started, each with its own clock", async () => {
    const db = seed({ metadata: { clue_delivery: "all_at_once" } });
    expect((await start("f2")).status).toBe(201);
    expect((await start("f0")).status).toBe(201);
    expect(db.table("find_completions").map((r) => r.find_id).sort()).toEqual(["f0", "f2"]);
  });

  it("refuses a stop from another hunt, a missing find_id and a non-string find_id", async () => {
    const db = seed();
    expect((await start("elsewhere")).status).toBe(404);
    expect((await start(undefined)).status).toBe(400);
    expect((await start({ id: "f0" })).status).toBe(400);
    expect(db.table("find_completions")).toHaveLength(0);
  });

  it("only starts stops in the caller's own active session", async () => {
    const db = seed();
    h.user = null;
    expect((await start("f0")).status).toBe(401);
    // u2 has no session here: u1's session must not be started for them.
    h.user = { id: "u2", role: "adult" };
    expect((await start("f0")).status).toBe(404);
    expect(db.table("find_completions")).toHaveLength(0);

    const finished = seed({ sessions: [{ id: SESSION, hunt_id: HUNT, user_id: "u1", status: "completed", metadata: {} }] });
    h.user = { id: "u1", role: "adult" };
    expect((await start("f0")).status).toBe(404);
    expect(finished.table("find_completions")).toHaveLength(0);
  });

  it("starts the stop in the caller's session when two players are in the hunt", async () => {
    const db = seed({
      sessions: [
        { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", metadata: {} },
        { id: "sess-2", hunt_id: HUNT, user_id: "u2", status: "active", team_id: "team-1", metadata: {} },
      ],
    });
    h.user = { id: "u2", role: "adult" };
    expect((await start("f0")).status).toBe(201);
    expect(db.table("find_completions").map((r) => r.play_session_id)).toEqual(["sess-2"]);
    // u1, on the same hunt, still has nothing released.
    h.user = { id: "u1", role: "adult" };
    expectNoSecrets(await (await stops()).json());
  });
});

describe("the other play routes hold a stop's details until it is started", () => {
  it("arrive: no distance or hot/cold reading before the start", async () => {
    const db = seed();
    const res = await arrive(req("POST", "/arrive", { find_id: "f0", ...AT_STOP }), playParams);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toMatch(/hasn't been started/);
    expect(body.distance).toBeUndefined();
    expect(body.hot_cold).toBeUndefined();
    expect(body.arrived).toBeUndefined();
    expect(db.table("find_completions")).toHaveLength(0);
  });

  it("arrive: works as before once the stop is started, and keeps the start time", async () => {
    const db = seed();
    const started = await (await start("f0")).json();
    const res = await arrive(req("POST", "/arrive", { find_id: "f0", ...AT_STOP }), playParams);
    expect(res.status).toBe(200);
    expect((await res.json()).arrived).toBe(true);
    const [row] = db.table("find_completions");
    expect(row.arrived_at).toBeTruthy();
    expect(row.started_at).toBe(started.started_at);
  });

  it("arrive-photo: no check-in before the start", async () => {
    const db = seed();
    const form = new FormData();
    form.append("find_id", "f0");
    form.append("file", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
    const res = await arrivePhoto(new NextRequest("http://localhost:3000/x", { method: "POST", body: form }), playParams);
    expect(res.status).toBe(409);
    expect(db.table("find_completions")).toHaveLength(0);
    expect(db.uploads).toHaveLength(0);
  });

  it("clue-hint: no hint before the start", async () => {
    const db = seed();
    const res = await clueHint(req("POST", "/clue-hint", { find_id: "f0", level: 1 }), playParams);
    expect(res.status).toBe(409);
    expectNoSecrets(await res.json());
    expect(db.table("find_completions")).toHaveLength(0);

    await start("f0");
    const after = await clueHint(req("POST", "/clue-hint", { find_id: "f0", level: 1 }), playParams);
    expect((await after.json()).hint).toBe(SECRETS.hint);
  });

  it("challenge hint: no hint before the start", async () => {
    seed();
    const res = await challengeHint(req("POST", "/hint", { find_id: "f0", level: 1 }), playParams);
    expect(res.status).toBe(409);
    expect(JSON.stringify(await res.json())).not.toContain("Use your ears");
  });

  it("AI hint: only for a stop the caller has started (or a hunt they manage)", async () => {
    seed();
    const ask = () => aiHint(req("POST", "/ai/hints", { find_id: "f0", level: 1 }));
    expect((await ask()).status).toBe(409);
    h.user = { id: "u2", role: "adult" };
    expect((await ask()).status).toBe(404);
    h.user = { id: "u1", role: "adult" };
    await start("f0");
    expect((await ask()).status).toBe(200);
    h.user = { id: "creator", role: "teacher" };
    expect((await ask()).status).toBe(200);
  });

  it("prime-viewed (older clients): the 'I'm ready' tap starts the stop, once", async () => {
    const db = seed();
    const tap = () => primeViewed(req("POST", "/prime-viewed", { find_id: "f0" }), playParams);
    expect((await tap()).status).toBe(201);
    const first = db.table("find_completions")[0].started_at;
    expect(first).toBeTruthy();
    expect((await tap()).status).toBe(200);
    expect(db.table("find_completions")[0].started_at).toBe(first);
    expect((await primeViewed(req("POST", "/prime-viewed", { find_id: "f1" }), playParams)).status).toBe(409);
  });

  it("the answer route's completion lookup carries the stop's start time", async () => {
    const db = seed();
    await start("f0");
    const row = await getCompletion(db.client as never, SESSION, "f0");
    expect(row?.started_at).toBe(db.table("find_completions")[0].started_at);
    expect(stopStartedAt(row)).toBe(row?.started_at);
  });
});

describe("stopStartedAt", () => {
  const base = { started_at: null, arrived_at: null, created_at: "2026-11-18T10:01:00.000Z" };

  it("is null without a completion row", () => {
    expect(stopStartedAt(null)).toBeNull();
  });

  it("prefers the recorded start, then the arrival, then the row's creation", () => {
    expect(stopStartedAt({ ...base, started_at: "2026-11-18T10:05:00.000Z", arrived_at: "2026-11-18T10:07:00.000Z" })).toBe(
      "2026-11-18T10:05:00.000Z"
    );
    expect(stopStartedAt({ ...base, arrived_at: "2026-11-18T10:07:00.000Z" })).toBe("2026-11-18T10:07:00.000Z");
    expect(stopStartedAt(base)).toBe("2026-11-18T10:01:00.000Z");
  });
});

describe("hunt APIs no longer hand stop details to players", () => {
  const huntParams = { params: Promise.resolve({ id: HUNT }) };

  it("GET /hunts/[id]/finds: a player gets ids and order only", async () => {
    seed();
    const res = await huntFinds(req("GET", `/hunts/${HUNT}/finds`), huntParams);
    const body = await res.json();
    expect(res.status).toBe(200);
    expectNoSecrets(body);
    expect(body.finds).toEqual(STOPS.map((id, i) => ({ id, sort_order: i })));
    expect(JSON.stringify(body)).not.toContain("Bells are tuned");
  });

  it("GET /hunts/[id]/finds: the creator and reviewers still get everything", async () => {
    seed();
    for (const user of [{ id: "creator", role: "teacher" }, { id: "adm", role: "admin" }, { id: "res", role: "researcher" }]) {
      h.user = user;
      const body = await (await huntFinds(req("GET", `/hunts/${HUNT}/finds`), huntParams)).json();
      expect(body.finds[0]).toMatchObject({ clue_text: SECRETS.clue, clue_hints: [SECRETS.hint], locations: { name: SECRETS.place } });
      expect(body.finds[0].tasks.content.correct_answer).toBe("52");
    }
  });

  it("the location library is for hunt builders: a player can't list or open places", async () => {
    seed();
    const one = (id: string) => getLocation(req("GET", `/locations/${id}`), { params: Promise.resolve({ id }) });
    const nearby = () => listLocations(req("GET", "/locations?lat=40.25&lng=-111.65&radius=5000"));

    for (const res of [await nearby(), await listLocations(req("GET", "/locations")), await one("loc-f0")]) {
      expect(res.status).toBe(403);
      expectNoSecrets(await res.json());
    }
    h.user = null;
    expect((await one("loc-f0")).status).toBe(401);

    h.user = { id: "creator", role: "teacher" };
    const res = await one("loc-f0");
    expect(res.status).toBe(200);
    expect((await res.json()).location.name).toBe(SECRETS.place);
    expect((await listLocations(req("GET", "/locations"))).status).toBe(200);
  });

  it("findsForViewer strips everything but id and order for anyone who can't edit the hunt", () => {
    const finds = [{ id: "f0", sort_order: 0, clue_text: SECRETS.clue, locations: { name: SECRETS.place }, tasks: null }];
    expect(findsForViewer(finds, { id: "u1", role: "adult" }, "creator")).toEqual([{ id: "f0", sort_order: 0 }]);
    expect(findsForViewer(finds, { id: "t2", role: "teacher" }, "creator")).toEqual([{ id: "f0", sort_order: 0 }]);
    expect(findsForViewer(finds, null, "creator")).toEqual([{ id: "f0", sort_order: 0 }]);
    expect(findsForViewer(finds, { id: "creator", role: "teacher" }, "creator")).toBe(finds);
    expect(findsForViewer(finds, { id: "adm", role: "admin" }, "creator")).toBe(finds);
  });
});
