import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row } from "@/__tests__/support/supabase-double";

/**
 * Who can read the rows hunts are built from (places, challenges with their
 * answer keys, primers) through the API. Players never; a builder their own
 * rows and the shared library; admins and researchers everything.
 */

const h = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return { createSupabaseServiceClient: async () => m.current().client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({ generalLimiter: { check: async () => {} } }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET as listTasks } from "@/app/api/v1/tasks/route";
import { GET as getTask } from "@/app/api/v1/tasks/[id]/route";
import { GET as listPrimers } from "@/app/api/v1/primers/route";
import { GET as getPrimer } from "@/app/api/v1/primers/[id]/route";
import { GET as listLocations } from "@/app/api/v1/locations/route";
import { GET as getLocation } from "@/app/api/v1/locations/[id]/route";
import { GET as search } from "@/app/api/v1/search/route";
import {
  isContentBuilder,
  mayReadContentRow,
  ownOrLibraryFilter,
  readsAllContent,
} from "@/lib/hunts/content-access";

const ANSWER = "the-answer-key-52";
const PLACE = "Secret Fountain";

const ada = { id: "ada", role: "hunt_creator" };
const bo = { id: "bo", role: "teacher" };
const player = { id: "pat", role: "adult" };
const admin = { id: "adm", role: "admin" };
const researcher = { id: "res", role: "researcher" };

function seed() {
  return installDouble({
    tasks: [
      { id: "t-ada", title: "Count the jets at the fountain", description: "fountain", challenge_type: "short_text", content: { correct_answer: ANSWER }, is_library: false, created_by: "ada", deleted_at: null, created_at: "2026-11-01" },
      { id: "t-bo", title: "Bo's challenge", description: "", challenge_type: "short_text", content: { correct_answer: "bo-key" }, is_library: false, created_by: "bo", deleted_at: null, created_at: "2026-11-02" },
      { id: "t-lib", title: "Library fountain challenge", description: "", challenge_type: "short_text", content: { correct_answer: "lib-key" }, is_library: true, created_by: null, deleted_at: null, created_at: "2026-11-03" },
    ],
    primers: [
      { id: "p-ada", title: "About the fountain", content: { body: "It is by the library" }, is_library: false, created_by: "ada", deleted_at: null, created_at: "2026-11-01" },
      { id: "p-lib", title: "Library primer", content: {}, is_library: true, created_by: null, deleted_at: null, created_at: "2026-11-02" },
    ],
    locations: [
      { id: "l-ada", name: PLACE, address: "1 Fountain Way", latitude: 40.25, longitude: -111.65, is_library: false, created_by: "ada", deleted_at: null, created_at: "2026-11-01" },
      { id: "l-bo", name: "Bo's fountain bench", address: "2 Bench Rd", latitude: 40.26, longitude: -111.66, is_library: false, created_by: "bo", deleted_at: null, created_at: "2026-11-02" },
      { id: "l-lib", name: "Library fountain plaza", address: "3 Plaza", latitude: 40.27, longitude: -111.67, is_library: true, created_by: null, deleted_at: null, created_at: "2026-11-03" },
    ],
    hunts: [],
  }, {
    rpc: {
      nearby_locations: () => [
        { id: "l-ada", name: PLACE, distance_meters: 10 },
        { id: "l-bo", name: "Bo's fountain bench", distance_meters: 20 },
        { id: "l-lib", name: "Library fountain plaza", distance_meters: 30 },
      ],
    },
  });
}

const req = (path: string) => new NextRequest(`http://localhost:3000/api/v1${path}`);
const item = (id: string) => ({ params: Promise.resolve({ id }) });
const ids = (rows: Row[]) => rows.map((r) => r.id).sort();

beforeEach(() => {
  seed();
});

describe("who reads what (lib/hunts/content-access)", () => {
  it("builders are the roles that make hunts; only admins and researchers read everything", () => {
    for (const role of ["teacher", "hunt_creator", "admin", "researcher"]) expect(isContentBuilder(role)).toBe(true);
    for (const role of ["adult", "teen", "child", "parent", null, undefined, ""]) expect(isContentBuilder(role)).toBe(false);
    expect(readsAllContent("admin")).toBe(true);
    expect(readsAllContent("researcher")).toBe(true);
    for (const role of ["teacher", "hunt_creator", "adult", null]) expect(readsAllContent(role)).toBe(false);
  });

  it("a builder may read their own rows and library rows; a player none", () => {
    const mine = { created_by: "ada", is_library: false };
    const theirs = { created_by: "bo", is_library: false };
    const shared = { created_by: null, is_library: true };
    expect([mine, theirs, shared].map((row) => mayReadContentRow(ada, row))).toEqual([true, false, true]);
    expect([mine, theirs, shared].map((row) => mayReadContentRow(admin, row))).toEqual([true, true, true]);
    expect([mine, theirs, shared].map((row) => mayReadContentRow(player, row))).toEqual([false, false, false]);
    expect(mayReadContentRow(ada, null)).toBe(false);
    // Only a real true marks a library row.
    expect(mayReadContentRow(ada, { created_by: "bo", is_library: "true" })).toBe(false);
  });

  it("builds the filter only from a plain id", () => {
    expect(ownOrLibraryFilter("3f2c-11", "created_by")).toBe("is_library.eq.true,created_by.eq.3f2c-11");
    for (const bad of ["a,b", "x.eq.y", "id)or(1", "", "a b"]) expect(() => ownOrLibraryFilter(bad)).toThrow();
    expect(() => ownOrLibraryFilter("ada", "created_by;drop")).toThrow();
  });
});

describe("GET /tasks and /primers", () => {
  it("are not for players: a challenge row carries its answer key", async () => {
    h.user = player;
    for (const res of [
      await listTasks(req("/tasks")),
      await getTask(req("/tasks/t-ada"), item("t-ada")),
      await getTask(req("/tasks/t-lib"), item("t-lib")),
      await listPrimers(req("/primers")),
      await getPrimer(req("/primers/p-ada"), item("p-ada")),
    ]) {
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toContain(ANSWER);
    }
    h.user = null;
    expect((await listTasks(req("/tasks"))).status).toBe(401);
  });

  it("a builder lists the library and their own rows, not another builder's", async () => {
    h.user = ada;
    expect(ids((await (await listTasks(req("/tasks"))).json()).tasks)).toEqual(["t-ada", "t-lib"]);
    expect(ids((await (await listPrimers(req("/primers"))).json()).primers)).toEqual(["p-ada", "p-lib"]);
    h.user = bo;
    const body = await (await listTasks(req("/tasks"))).json();
    expect(ids(body.tasks)).toEqual(["t-bo", "t-lib"]);
    expect(JSON.stringify(body)).not.toContain(ANSWER);
    expect(ids((await (await listPrimers(req("/primers"))).json()).primers)).toEqual(["p-lib"]);
  });

  it("library=true is the library alone", async () => {
    h.user = ada;
    expect(ids((await (await listTasks(req("/tasks?library=true"))).json()).tasks)).toEqual(["t-lib"]);
  });

  it("another builder's row reads as missing when opened by id", async () => {
    h.user = bo;
    const res = await getTask(req("/tasks/t-ada"), item("t-ada"));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain(ANSWER);
    expect((await getPrimer(req("/primers/p-ada"), item("p-ada"))).status).toBe(404);
    // Their own and the library open as before.
    expect((await getTask(req("/tasks/t-bo"), item("t-bo"))).status).toBe(200);
    expect((await getTask(req("/tasks/t-lib"), item("t-lib"))).status).toBe(200);
    h.user = ada;
    expect((await (await getTask(req("/tasks/t-ada"), item("t-ada"))).json()).task.content.correct_answer).toBe(ANSWER);
  });

  it("admins and researchers read every row", async () => {
    for (const user of [admin, researcher]) {
      h.user = user;
      expect(ids((await (await listTasks(req("/tasks"))).json()).tasks)).toEqual(["t-ada", "t-bo", "t-lib"]);
      expect((await getTask(req("/tasks/t-ada"), item("t-ada"))).status).toBe(200);
    }
  });

  it("caps how many rows one request returns", async () => {
    h.user = admin;
    const res = await listTasks(req("/tasks?limit=100000"));
    expect(res.status).toBe(200);
    expect((await (await listTasks(req("/tasks?limit=1"))).json()).tasks).toHaveLength(1);
    expect((await (await listTasks(req("/tasks?limit=nonsense"))).json()).tasks).toHaveLength(3);
  });
});

describe("GET /locations", () => {
  it("a builder lists, finds nearby and opens only the library and their own places", async () => {
    h.user = bo;
    expect(ids((await (await listLocations(req("/locations"))).json()).locations)).toEqual(["l-bo", "l-lib"]);
    const nearby = await (await listLocations(req("/locations?lat=40.25&lng=-111.65&radius=5000"))).json();
    expect(ids(nearby.locations)).toEqual(["l-bo", "l-lib"]);
    expect(JSON.stringify(nearby)).not.toContain(PLACE);
    expect((await getLocation(req("/locations/l-ada"), item("l-ada"))).status).toBe(404);
    expect((await getLocation(req("/locations/l-bo"), item("l-bo"))).status).toBe(200);
    expect((await getLocation(req("/locations/l-lib"), item("l-lib"))).status).toBe(200);
  });

  it("the nearby search keeps the order it was given", async () => {
    h.user = ada;
    const nearby = await (await listLocations(req("/locations?lat=40.25&lng=-111.65"))).json();
    expect(nearby.locations.map((l: Row) => l.id)).toEqual(["l-ada", "l-lib"]);
  });

  it("admins and researchers see every place", async () => {
    for (const user of [admin, researcher]) {
      h.user = user;
      expect(ids((await (await listLocations(req("/locations"))).json()).locations)).toEqual(["l-ada", "l-bo", "l-lib"]);
      expect(ids((await (await listLocations(req("/locations?lat=40.25&lng=-111.65"))).json()).locations)).toEqual(["l-ada", "l-bo", "l-lib"]);
      expect((await getLocation(req("/locations/l-ada"), item("l-ada"))).status).toBe(200);
    }
  });

  it("players still get nothing", async () => {
    h.user = player;
    expect((await listLocations(req("/locations"))).status).toBe(403);
    expect((await getLocation(req("/locations/l-lib"), item("l-lib"))).status).toBe(403);
  });
});

describe("GET /search", () => {
  const find = async (q: string) => (await search(req(`/search?q=${q}`))).json();

  beforeEach(() => {
    // The double does not implement text search or ilike: stand in for them
    // by matching on the title/name/address, which is all these tests need.
    const db = seed();
    const realFrom = db.client.from;
    db.client.from = ((table: string) => {
      const query = realFrom(table) as unknown as Record<string, unknown>;
      query.textSearch = () => query;
      query.or = (expr: string) => {
        const needle = /ilike\.%([^%]*)%/.exec(expr)?.[1]?.toLowerCase() ?? "";
        const source = db.table(table);
        db.replace(table, source.filter((r) => `${r.title ?? ""} ${r.name ?? ""} ${r.address ?? ""} ${r.description ?? ""}`.toLowerCase().includes(needle)));
        return query;
      };
      return query;
    }) as unknown as typeof db.client.from;
  });

  it("someone not signed in finds library challenges only, and no places", async () => {
    h.user = null;
    const { results } = await find("fountain");
    expect(ids(results.tasks)).toEqual(["t-lib"]);
    expect(results.locations).toEqual([]);
    expect(JSON.stringify(results)).not.toContain("Count the jets");
  });

  it("a player gets the same: a hunt's own challenge titles are not searchable", async () => {
    h.user = player;
    const { results } = await find("fountain");
    expect(ids(results.tasks)).toEqual(["t-lib"]);
    expect(results.locations).toEqual([]);
  });

  it("a builder finds library places, not another builder's", async () => {
    h.user = bo;
    const { results } = await find("fountain");
    expect(ids(results.locations)).toEqual(["l-lib"]);
    expect(JSON.stringify(results)).not.toContain(PLACE);
  });

  it("admins and researchers find every place", async () => {
    h.user = admin;
    const { results } = await find("fountain");
    expect(ids(results.locations)).toEqual(["l-ada", "l-bo", "l-lib"]);
  });
});
