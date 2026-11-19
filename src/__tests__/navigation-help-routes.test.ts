import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";
import { haversineDistance } from "@/lib/services/hot-cold";

/**
 * Issue #15: a hunt's navigation help level ("Difficulty": easy, medium, hard)
 * is enforced by the server. In Medium and Hard the stop's coordinates and
 * place name stay on the server until the stop is completed; in Hard so do the
 * distance and the hot/cold zone. Easy, and a hunt with no setting, behave
 * exactly as before.
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
  aiLimiter: { check: async () => {} },
  generalLimiter: { check: async () => {} },
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/utils/track-event", () => ({ trackEvent: async () => {} }));
vi.mock("@/lib/utils/run-after", () => ({ runAfter: () => {} }));
vi.mock("@/lib/services/findbot", () => ({ generateHint: async () => "An AI hint that names the Centennial Bell Tower" }));

import { GET as getStops } from "@/app/api/v1/play/[huntId]/stops/route";
import { POST as startStop } from "@/app/api/v1/play/[huntId]/start-stop/route";
import { POST as startHunt } from "@/app/api/v1/play/[huntId]/start/route";
import { POST as arrive } from "@/app/api/v1/play/[huntId]/arrive/route";
import { POST as arrivePhoto } from "@/app/api/v1/play/[huntId]/arrive-photo/route";
import { POST as clueHint } from "@/app/api/v1/play/[huntId]/clue-hint/route";
import { POST as aiHint } from "@/app/api/v1/ai/hints/route";
import { PUT as updateHunt } from "@/app/api/v1/hunts/[id]/route";
import { POST as createHunt } from "@/app/api/v1/hunts/route";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const STOPS = ["f0", "f1", "f2"];
const STOP = { latitude: 40.25, longitude: -111.65 };
/** About 400 m north of the stop: far outside its 50 m radius. */
const FAR = { latitude: 40.2536, longitude: -111.65 };
const FAR_METERS = Math.round(haversineDistance(FAR.latitude, FAR.longitude, STOP.latitude, STOP.longitude));
const ZONES = ["icy", "cold", "warm", "hot", "burning"];

const PLACE = "Centennial Bell Tower";
const CLUE = "Look for the carillon";
const SAFETY = "Mind the cyclists";

const EMBEDS = {
  finds: {
    locations: { table: "locations", localKey: "location_id" },
    tasks: { table: "tasks", localKey: "task_id" },
    primers: { table: "primers", localKey: "primer_id" },
  },
};

interface SeedOptions {
  status?: string;
  sessions?: Row[];
  completions?: Row[];
}

function seed(metadata: Row, opts: SeedOptions = {}): SupabaseDouble {
  return installDouble(
    {
      hunts: [
        {
          id: HUNT, title: "Hunt", status: opts.status ?? "published", review_status: "approved", identity_mode: "real_name",
          play_mode: "solo", created_by: "creator", deleted_at: null, metadata,
        },
      ],
      play_sessions: opts.sessions ?? [
        { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: "2026-11-18T10:00:00.000Z", metadata: {} },
      ],
      locations: STOPS.map((id) => ({
        id: `loc-${id}`, name: PLACE, description: "A tall brick tower", address: "900 Campus Drive",
        ...STOP, radius_meters: 50, safety_notes: SAFETY,
      })),
      tasks: STOPS.map((id) => ({
        id: `task-${id}`, title: "Count the bells", challenge_type: "numeric_entry",
        content: { question: "How many bells?", correct_answer: "52" },
      })),
      primers: [],
      finds: STOPS.map((id, i) => ({
        id, hunt_id: HUNT, sort_order: i, deleted_at: null, clue_text: CLUE, clue_hints: ["It rings on the hour"],
        hot_cold_enabled: true, scaffolding_level: "medium", reading_check: null,
        location_id: `loc-${id}`, task_id: `task-${id}`, primer_id: null,
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
  started_at: "2026-11-18T10:05:00.000Z",
  arrived_at: null,
  completed_at: null,
  hints_used: 0,
  clue_hints_used: 0,
  metadata: {},
  created_at: "2026-11-18T10:05:00.000Z",
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
const huntParams = { params: Promise.resolve({ id: HUNT }) };
const stops = async () => (await getStops(req("GET", "/stops"), playParams)).json();
const start = (findId: string) => startStop(req("POST", "/start-stop", { find_id: findId }), playParams);
const ping = (position: Row, extra: Row = {}) =>
  arrive(req("POST", "/arrive", { find_id: "f0", accuracy: 5, ...position, ...extra }), playParams);
const tap = (position: Row) => ping(position, { manual: true });

/** The stop's position, in any form, must not be in what the browser receives. */
function expectNoCoordinates(payload: unknown): void {
  const text = JSON.stringify(payload);
  expect(text, "stop latitude").not.toContain("40.25");
  expect(text, "stop longitude").not.toContain("111.65");
  expect(text, "place name").not.toContain(PLACE);
  expect(text, "address").not.toContain("900 Campus Drive");
  expect(text).not.toMatch(/"(bearing|heading|direction)"/);
}

/** Hard: nothing that says how far away, or in which heat zone, the stop is. */
function expectNoDistanceOrZone(body: Row): void {
  expect(body.distance ?? null).toBeNull();
  expect(body.hot_cold ?? null).toBeNull();
  const text = JSON.stringify(body);
  expect(text).not.toContain(String(FAR_METERS));
  for (const zone of ZONES) expect(text).not.toContain(`"${zone}"`);
  expect(text).not.toMatch(/"(bearing|heading|direction|distanceLabel|zone)"/);
}

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
});

describe("Easy, and hunts with no setting, are unchanged", () => {
  it.each([{}, { navigation_help: "easy" }, { navigation_help: "nonsense" }])(
    "a started stop comes with its place and coordinates (%j)",
    async (metadata) => {
      seed({ clue_delivery: "fixed_order", ...metadata });
      const started = await (await start("f0")).json();
      const place = { name: PLACE, ...STOP, radius_meters: 50, safety_notes: SAFETY };
      expect(started.stop).toMatchObject({ clue_text: CLUE, hot_cold_enabled: true, locations: place });
      const body = await stops();
      expect(body.stops[0]).toMatchObject({ clue_text: CLUE, hot_cold_enabled: true, locations: place });
      expect(body.navigation_help).toBe("easy");
    }
  );

  it("an unset level gives the same stops and readings as an explicit Easy", async () => {
    const run = async (metadata: Row) => {
      seed(metadata, { completions: [completion("f0")] });
      return {
        stops: await stops(),
        far: await (await ping(FAR)).json(),
        tapFar: await (await tap(FAR)).json(),
      };
    };
    const unset = await run({ clue_delivery: "fixed_order" });
    const easy = await run({ clue_delivery: "fixed_order", navigation_help: "easy" });
    expect(unset).toEqual(easy);
    expect(unset.far).toMatchObject({ arrived: false, reason: "too_far", hot_cold_enabled: true });
    expect(Math.round(unset.far.distance)).toBe(FAR_METERS);
    expect(ZONES).toContain(unset.far.hot_cold.zone);
  });

  it("a GPS ping inside the radius still records the arrival on its own", async () => {
    const db = seed({}, { completions: [completion("f0")] });
    const body = await (await ping(STOP)).json();
    expect(body.arrived).toBe(true);
    expect(typeof body.distance).toBe("number");
    expect(db.table("find_completions")[0].arrived_at).toBeTruthy();
  });
});

describe.each(["medium", "hard"])("%s: the stop's coordinates never reach the browser before it is completed", (level) => {
  const metadata = { clue_delivery: "fixed_order", navigation_help: level };

  it("start-stop releases the clue and the challenge, not the place", async () => {
    seed(metadata);
    const res = await start("f0");
    const body = await res.json();
    expect(res.status).toBe(201);
    expectNoCoordinates(body);
    expect(body.stop).toMatchObject({
      id: "f0",
      clue_text: CLUE,
      tasks: { title: "Count the bells" },
      // The creator's safety note still reaches the player.
      locations: { name: null, latitude: null, longitude: null, safety_notes: SAFETY },
    });
  });

  it("stops: nothing about where a started stop is, on first load or on a reload", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const body = await stops();
    expectNoCoordinates(body);
    expect(body.navigation_help).toBe(level);
    expect(body.stops[0]).toMatchObject({ started_at: "2026-11-18T10:05:00.000Z", clue_text: CLUE });
    expect(body.stops[0].locations).toMatchObject({ latitude: null, longitude: null, name: null });
  });

  it("stops: still nothing after arriving, while the challenge is open", async () => {
    seed(metadata, { completions: [completion("f0", { arrived_at: "2026-11-18T10:09:00.000Z" })] });
    expectNoCoordinates(await stops());
  });

  it("every arrive reply is free of the stop's position: far, near, tapped, no GPS", async () => {
    seed(metadata, { completions: [completion("f0")] });
    for (const res of [await ping(FAR), await tap(FAR), await tap({}), await ping({}), await tap(STOP), await ping(STOP)]) {
      expectNoCoordinates(await res.json());
    }
  });

  it("the place is released once the stop is completed", async () => {
    seed(metadata, {
      completions: [completion("f0", { arrived_at: "2026-11-18T10:09:00.000Z", completed_at: "2026-11-18T10:12:00.000Z" })],
    });
    const body = await stops();
    expect(body.stops[0].locations).toMatchObject({ name: PLACE, ...STOP });
    // The next stop is open but not started: still nothing.
    expect(body.stops[1].locations).toBeNull();
    const again = await (await start("f0")).json();
    expect(again.stop.locations).toMatchObject({ name: PLACE, ...STOP });
  });

  it("all clues at once: one finished stop releases only its own place", async () => {
    seed({ clue_delivery: "all_at_once", navigation_help: level }, {
      completions: [
        completion("f0", { arrived_at: "2026-11-18T10:09:00.000Z", completed_at: "2026-11-18T10:12:00.000Z" }),
        completion("f1"),
      ],
    });
    const body = await stops();
    expect(body.stops[0].locations.latitude).toBe(STOP.latitude);
    expectNoCoordinates(body.stops.slice(1));
  });

  it("clue hints keep working", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const res = await clueHint(req("POST", "/clue-hint", { find_id: "f0", level: 1 }), playParams);
    expect(res.status).toBe(200);
    expect((await res.json()).hint).toBe("It rings on the hour");
  });

  it("the AI hint is written from the place name, so it waits for the arrival", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const ask = () => aiHint(req("POST", "/ai/hints", { find_id: "f0", level: 1 }));
    const early = await ask();
    expect(early.status).toBe(409);
    expectNoCoordinates(await early.json());

    seed(metadata, { completions: [completion("f0", { arrived_at: "2026-11-18T10:09:00.000Z" })] });
    expect((await ask()).status).toBe(200);
    // The people who can edit the hunt are not playing it.
    seed(metadata, { completions: [] });
    h.user = { id: "creator", role: "teacher" };
    expect((await ask()).status).toBe(200);
  });

  it("the play session records the level, and the player is told it", async () => {
    const db = seed(metadata, { sessions: [] });
    const res = await startHunt(req("POST", "/start", {}), playParams);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.navigation_help).toBe(level);
    expect(db.table("play_sessions")[0].metadata).toMatchObject({ clue_delivery: "fixed_order", navigation_help: level });
    expectNoCoordinates(body);
  });
});

describe("medium: the hot/cold reading comes from the server, without coordinates", () => {
  const metadata = { clue_delivery: "fixed_order", navigation_help: "medium" };

  it("a GPS ping far away gets a distance and a zone, nothing else about the stop", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const body = await (await ping(FAR)).json();
    expect(body).toMatchObject({ arrived: false, reason: "too_far", hot_cold_enabled: true });
    expect(Math.round(body.distance)).toBe(FAR_METERS);
    expect(ZONES).toContain(body.hot_cold.zone);
    expect(typeof body.hot_cold.distanceLabel).toBe("string");
    expectNoCoordinates(body);
  });

  it("the reading is the same one an Easy hunt gets", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const medium = await (await ping(FAR)).json();
    seed({ clue_delivery: "fixed_order" }, { completions: [completion("f0")] });
    expect(medium).toEqual(await (await ping(FAR)).json());
  });

  it("walking into the radius still arrives on its own", async () => {
    const db = seed(metadata, { completions: [completion("f0")] });
    expect((await (await ping(STOP)).json()).arrived).toBe(true);
    expect(db.table("find_completions")[0].arrived_at).toBeTruthy();
  });

  it("a stop with hot/cold switched off still gives no reading", async () => {
    const db = seed(metadata, { completions: [completion("f0")] });
    db.table("finds")[0].hot_cold_enabled = false;
    const body = await (await ping(FAR)).json();
    expect(body.distance).toBeNull();
    expect(body.hot_cold).toBeNull();
  });
});

describe("hard: no distance, zone or direction, and arrival only by tapping I'm here", () => {
  const metadata = { clue_delivery: "fixed_order", navigation_help: "hard" };

  it("a started stop says its meter is off", async () => {
    seed(metadata);
    expect((await (await start("f0")).json()).stop.hot_cold_enabled).toBe(false);
    expect((await stops()).stops[0].hot_cold_enabled).toBe(false);
  });

  it("a GPS ping gets no reading, however far or near", async () => {
    const db = seed(metadata, { completions: [completion("f0")] });
    for (const position of [FAR, STOP, {}]) {
      const res = await ping(position);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.arrived).toBe(false);
      expectNoDistanceOrZone(body);
    }
    // Standing on the stop is not enough: nothing was recorded.
    expect(db.table("find_completions")[0].arrived_at).toBeNull();
  });

  it("the reply to a ping is the same wherever the player is", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const far = await (await ping(FAR)).json();
    const near = await (await ping(STOP)).json();
    expect(far).toEqual(near);
  });

  it("I'm here from too far away: refused, without saying how far or which way", async () => {
    const db = seed(metadata, { completions: [completion("f0")] });
    const body = await (await tap(FAR)).json();
    expect(body).toMatchObject({ arrived: false, reason: "too_far", photo_allowed: false, hot_cold_enabled: false });
    expectNoDistanceOrZone(body);
    expect(db.table("find_completions")[0].arrived_at).toBeNull();
  });

  it("I'm here at the stop: the arrival is recorded, still with no distance", async () => {
    const db = seed(metadata, { completions: [completion("f0")] });
    const res = await tap(STOP);
    const body = await res.json();
    expect(body.arrived).toBe(true);
    expectNoDistanceOrZone(body);
    const [row] = db.table("find_completions");
    expect(row.arrived_at).toBeTruthy();
    expect((row.metadata as Row).arrival_method).toBe("gps_tap");
  });

  it("I'm here with no GPS still offers the photo check-in", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const body = await (await tap({})).json();
    expect(body).toMatchObject({ arrived: false, reason: "no_gps", photo_allowed: true });
    expectNoDistanceOrZone(body);
  });

  it("a photo check-in from clearly elsewhere is refused without a distance", async () => {
    seed(metadata, { completions: [completion("f0")] });
    const form = new FormData();
    form.append("find_id", "f0");
    form.append("file", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
    form.append("latitude", String(FAR.latitude));
    form.append("longitude", String(FAR.longitude));
    form.append("accuracy", "5");
    const res = await arrivePhoto(new NextRequest("http://localhost:3000/x", { method: "POST", body: form }), playParams);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(JSON.stringify(body)).not.toMatch(/\d/);
    expectNoCoordinates(body);
  });
});

describe("setting the level", () => {
  const put = (metadata: Row) => updateHunt(req("PUT", `/hunts/${HUNT}`, { metadata }), huntParams);
  const stored = (db: SupabaseDouble) => db.table("hunts")[0].metadata as Row;

  beforeEach(() => {
    h.user = { id: "creator", role: "teacher" };
  });

  it("the creator can set any level on a draft nobody has played", async () => {
    for (const level of ["medium", "hard", "easy"]) {
      const db = seed({ clue_delivery: "fixed_order" }, { status: "draft", sessions: [] });
      const res = await put({ clue_delivery: "fixed_order", navigation_help: level });
      expect(res.status).toBe(200);
      expect(stored(db).navigation_help).toBe(level);
    }
  });

  it("admins and researchers can set it on someone else's hunt", async () => {
    for (const user of [{ id: "adm", role: "admin" }, { id: "res", role: "researcher" }]) {
      h.user = user;
      const db = seed({}, { status: "draft", sessions: [] });
      expect((await put({ navigation_help: "hard" })).status).toBe(200);
      expect(stored(db).navigation_help).toBe("hard");
    }
  });

  it("nobody else can: another teacher, a player, a signed-out visitor", async () => {
    for (const user of [{ id: "t2", role: "teacher" }, { id: "u1", role: "adult" }, null]) {
      h.user = user;
      const db = seed({}, { status: "draft", sessions: [] });
      const res = await put({ navigation_help: "hard" });
      expect([401, 403]).toContain(res.status);
      expect(stored(db).navigation_help).toBeUndefined();
    }
  });

  it("rejects a level that doesn't exist", async () => {
    const db = seed({}, { status: "draft", sessions: [] });
    const res = await put({ navigation_help: "impossible" });
    expect(res.status).toBe(400);
    expect(stored(db).navigation_help).toBeUndefined();
  });

  it("can't be changed once someone has played the hunt, even after unpublishing", async () => {
    const db = seed({ navigation_help: "medium" }, { status: "draft" });
    for (const level of ["hard", "easy"]) {
      const res = await put({ navigation_help: level });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Difficulty is locked/);
    }
    expect(stored(db).navigation_help).toBe("medium");
    // Admins are held to the same lock.
    h.user = { id: "adm", role: "admin" };
    expect((await put({ navigation_help: "hard" })).status).toBe(409);
  });

  it("can't be raised from the default once someone has played", async () => {
    const db = seed({ clue_delivery: "fixed_order" }, { status: "draft" });
    expect((await put({ clue_delivery: "fixed_order", navigation_help: "hard" })).status).toBe(409);
    expect(stored(db).navigation_help).toBeUndefined();
  });

  it("can't be changed while the hunt is published", async () => {
    seed({ navigation_help: "easy" }, { sessions: [] });
    expect((await put({ navigation_help: "hard" })).status).toBe(409);
  });

  it("a locked hunt keeps its level when another setting is saved without it", async () => {
    const db = seed({ clue_delivery: "fixed_order", navigation_help: "hard" }, { status: "draft" });
    const res = await put({ clue_delivery: "fixed_order", hide_scores: true });
    expect(res.status).toBe(200);
    expect(stored(db)).toMatchObject({ navigation_help: "hard", hide_scores: true });
  });

  it("a locked hunt can be saved with its level unchanged", async () => {
    seed({ navigation_help: "hard" }, { status: "draft" });
    expect((await put({ navigation_help: "hard", hide_scores: true })).status).toBe(200);
  });

  it("a new hunt can be created at a level, but not at a made-up one", async () => {
    const db = seed({});
    const create = (metadata: Row) => createHunt(req("POST", "/hunts", { title: "New hunt", metadata }));
    const res = await create({ navigation_help: "medium" });
    expect(res.status).toBe(201);
    expect((await res.json()).hunt.metadata.navigation_help).toBe("medium");
    const before = db.table("hunts").length;
    expect((await create({ navigation_help: "impossible" })).status).toBe(400);
    expect(db.table("hunts")).toHaveLength(before);
  });
});
