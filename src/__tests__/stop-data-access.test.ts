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
import { GET as listLocations, POST as createLocation } from "@/app/api/v1/locations/route";
import { GET as getLocation, PUT as updateLocation } from "@/app/api/v1/locations/[id]/route";
import { POST as addStop } from "@/app/api/v1/hunts/[id]/finds/route";
import { PUT as updateStop } from "@/app/api/v1/hunts/[id]/finds/[findId]/route";
import { GET as search } from "@/app/api/v1/search/route";
import { GET as curriculum } from "@/app/api/v1/curriculum/route";
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

describe("GET /curriculum?standard=", () => {
  const byStandard = async () => (await curriculum(req("/curriculum?standard=RL.5.1"))).json();

  beforeEach(() => {
    const db = seed();
    db.table("education_standards").push({ id: "std-1", code: "RL.5.1" });
    db.table("task_standard_alignments").push(
      { standard_id: "std-1", task_id: "t-ada", alignment_strength: "strong" },
      { standard_id: "std-1", task_id: "t-lib", alignment_strength: "strong" }
    );
    db.embeds.task_standard_alignments = { tasks: { table: "tasks", localKey: "task_id" } };
  });

  it("returns library challenges only, even when a hunt's own challenge is aligned to the standard", async () => {
    for (const user of [null, player, bo, admin]) {
      h.user = user;
      const body = await byStandard();
      expect(ids(body.tasks)).toEqual(["t-lib"]);
      expect(JSON.stringify(body)).not.toContain(ANSWER);
    }
  });

  it("fills the page with library challenges, however many other challenges are aligned first", async () => {
    const db = seed();
    db.table("education_standards").push({ id: "std-1", code: "RL.5.1" });
    db.embeds.task_standard_alignments = { tasks: { table: "tasks", localKey: "task_id" } };
    // Three alignments to a hunt's own challenge come before the library one.
    db.table("task_standard_alignments").push(
      { standard_id: "std-1", task_id: "t-ada", alignment_strength: "strong" },
      { standard_id: "std-1", task_id: "t-ada", alignment_strength: "strong" },
      { standard_id: "std-1", task_id: "t-ada", alignment_strength: "strong" },
      { standard_id: "std-1", task_id: "t-lib", alignment_strength: "strong" },
      { standard_id: "std-1", task_id: "t-lib", alignment_strength: "partial" }
    );
    h.user = bo;
    const page = await (await curriculum(req("/curriculum?standard=RL.5.1&limit=1"))).json();
    expect(ids(page.tasks)).toEqual(["t-lib"]);
  });

  it("keeps the library answer key for builders and strips it for everyone else", async () => {
    h.user = bo;
    expect((await byStandard()).tasks[0].content.correct_answer).toBe("lib-key");
    h.user = player;
    expect(JSON.stringify(await byStandard())).not.toContain("lib-key");
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

describe("what a stop may point at", () => {
  const HUNT_ADA = "11111111-1111-4111-8111-111111111111";
  const T_ADA = "aaaaaaaa-0000-4000-8000-000000000001";
  const T_BO = "bbbbbbbb-0000-4000-8000-000000000001";
  const T_LIB = "cccccccc-0000-4000-8000-000000000001";
  const L_BO = "bbbbbbbb-0000-4000-8000-000000000002";
  const P_BO = "bbbbbbbb-0000-4000-8000-000000000003";
  const MISSING = "dddddddd-0000-4000-8000-000000000009";
  const huntParams = { params: Promise.resolve({ id: HUNT_ADA }) };
  const stopParams = (findId: string) => ({ params: Promise.resolve({ id: HUNT_ADA, findId }) });
  const json = (method: string, path: string, body: Row) =>
    new NextRequest(`http://localhost:3000/api/v1${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const post = (body: Row) => addStop(json("POST", `/hunts/${HUNT_ADA}/finds`, body), huntParams);
  const put = (findId: string, body: Row) => updateStop(json("PUT", `/hunts/${HUNT_ADA}/finds/${findId}`, body), stopParams(findId));

  function seedBuilder(finds: Row[] = []) {
    return installDouble(
      {
        hunts: [{ id: HUNT_ADA, created_by: "ada", status: "draft", review_status: "not_submitted", metadata: {}, deleted_at: null, starts_at: null, ends_at: null }],
        finds,
        tasks: [
          { id: T_ADA, title: "Ada's", content: { correct_answer: "ada-key" }, is_library: false, created_by: "ada", deleted_at: null },
          { id: T_BO, title: "Bo's", content: { correct_answer: ANSWER }, is_library: false, created_by: "bo", deleted_at: null },
          { id: T_LIB, title: "Library", content: { correct_answer: "lib-key" }, is_library: true, created_by: null, deleted_at: null },
        ],
        locations: [{ id: L_BO, name: PLACE, latitude: 40.25, longitude: -111.65, is_library: false, created_by: "bo", deleted_at: null }],
        primers: [{ id: P_BO, title: "Bo's primer", content: { body: "By the fountain" }, is_library: false, created_by: "bo", deleted_at: null }],
        play_sessions: [],
        hunt_clue_orders: [],
      },
      {
        embeds: {
          finds: {
            locations: { table: "locations", localKey: "location_id" },
            tasks: { table: "tasks", localKey: "task_id" },
            primers: { table: "primers", localKey: "primer_id" },
          },
        },
      }
    );
  }

  beforeEach(() => {
    h.user = ada;
  });

  it("their own challenge or a library one: saved", async () => {
    for (const task_id of [T_ADA, T_LIB]) {
      const db = seedBuilder();
      const res = await post({ task_id, clue_text: "Go" });
      expect(res.status).toBe(201);
      expect(db.table("finds")[0].task_id).toBe(task_id);
    }
  });

  it("another builder's challenge, place or primer: refused, and nothing about it comes back", async () => {
    for (const body of [{ task_id: T_BO }, { location_id: L_BO }, { primer_id: P_BO }] as Row[]) {
      const db = seedBuilder();
      const res = await post({ ...body, clue_text: "Go" });
      expect(res.status).toBe(403);
      const text = JSON.stringify(await res.json());
      expect(text).toMatch(/isn't one of yours or in the shared library/);
      expect(text).not.toContain(ANSWER);
      expect(text).not.toContain(PLACE);
      expect(db.table("finds")).toHaveLength(0);
    }
  });

  it("an id that does not exist is refused the same way", async () => {
    seedBuilder();
    const res = await post({ task_id: MISSING, clue_text: "Go" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/isn't one of yours or in the shared library/);
    expect((await post({ task_id: "not-an-id", clue_text: "Go" })).status).toBe(400);
  });

  it("changing an existing stop follows the same rule", async () => {
    const db = seedBuilder([{ id: "f1", hunt_id: HUNT_ADA, sort_order: 0, task_id: T_ADA, location_id: null, primer_id: null, deleted_at: null }]);
    const refused = await put("f1", { task_id: T_BO });
    expect(refused.status).toBe(403);
    expect(JSON.stringify(await refused.json())).not.toContain(ANSWER);
    expect(db.table("finds")[0].task_id).toBe(T_ADA);
    expect((await put("f1", { task_id: T_LIB })).status).toBe(200);
    expect(db.table("finds")[0].task_id).toBe(T_LIB);
  });

  it("a row the hunt already uses can stay on its stops: a copied hunt remains editable", async () => {
    // The hunt's first stop points at Bo's challenge (it was copied from Bo's template).
    const db = seedBuilder([
      { id: "f1", hunt_id: HUNT_ADA, sort_order: 0, task_id: T_BO, location_id: null, primer_id: null, deleted_at: null },
      { id: "f2", hunt_id: HUNT_ADA, sort_order: 1, task_id: null, location_id: null, primer_id: null, deleted_at: null },
    ]);
    expect((await put("f1", { task_id: T_BO, clue_text: "Reworded" })).status).toBe(200);
    expect((await put("f2", { task_id: T_BO })).status).toBe(200);
    expect(db.table("finds")[1].task_id).toBe(T_BO);
  });

  it("a stop keeps a challenge that was removed after it was attached", async () => {
    // The editor resends a stop's ids on every save.
    const db = seedBuilder([{ id: "f1", hunt_id: HUNT_ADA, sort_order: 0, task_id: T_ADA, location_id: null, primer_id: null, deleted_at: null }]);
    db.table("tasks").find((row) => row.id === T_ADA)!.deleted_at = "2026-01-01T00:00:00.000Z";
    expect((await put("f1", { task_id: T_ADA, clue_text: "Reworded" })).status).toBe(200);
    // A removed row the hunt does not use is still refused.
    db.table("tasks").find((row) => row.id === T_LIB)!.deleted_at = "2026-01-01T00:00:00.000Z";
    expect((await put("f1", { task_id: T_LIB })).status).toBe(403);
  });

  it("admins and researchers may use any row", async () => {
    for (const user of [admin, researcher]) {
      h.user = user;
      seedBuilder();
      expect((await post({ task_id: T_BO, location_id: L_BO, clue_text: "Go" })).status).toBe(201);
    }
  });

  it("wording and settings edits are not affected", async () => {
    seedBuilder([{ id: "f1", hunt_id: HUNT_ADA, sort_order: 0, task_id: T_ADA, location_id: null, primer_id: null, deleted_at: null }]);
    expect((await put("f1", { clue_text: "A clearer clue", hot_cold_enabled: false })).status).toBe(200);
  });
});

describe("the shared library of places", () => {
  const json = (method: string, path: string, body: Row) =>
    new NextRequest(`http://localhost:3000/api/v1${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const create = (body: Row) => createLocation(json("POST", "/locations", body));
  const update = (id: string, body: Row) => updateLocation(json("PUT", `/locations/${id}`, body), item(id));
  const place = { name: "A bench", latitude: 40.3, longitude: -111.7 };
  // The double has no insert_location function, so the route takes its plain insert path.
  const seedPlaces = () => {
    const db = seed();
    db.rpcHandlers.insert_location = () => {
      throw new Error("function insert_location does not exist");
    };
    return db;
  };

  it("a builder cannot add a place to it, when creating or by editing their own", async () => {
    h.user = bo;
    const db = seedPlaces();
    const before = db.table("locations").length;
    const created = await create({ ...place, is_library: true });
    expect(created.status).toBe(403);
    expect(db.table("locations")).toHaveLength(before);
    expect((await update("l-bo", { is_library: true })).status).toBe(403);
    expect(db.table("locations").find((l) => l.id === "l-bo")?.is_library).toBe(false);
  });

  it("only a real true or false is accepted", async () => {
    h.user = admin;
    seedPlaces();
    for (const value of ["true", 1, "yes"]) {
      expect((await create({ ...place, is_library: value })).status).toBe(400);
    }
  });

  it("an admin can, and a builder's ordinary place is not in the library", async () => {
    h.user = admin;
    let db = seedPlaces();
    expect((await create({ ...place, is_library: true })).status).toBe(201);
    expect(db.table("locations").at(-1)?.is_library).toBe(true);
    h.user = bo;
    db = seedPlaces();
    expect((await create(place)).status).toBe(201);
    expect(db.table("locations").at(-1)).toMatchObject({ is_library: false, created_by: "bo" });
  });
});

describe("the area search", () => {
  it("looks past other people's places nearby to find the builder's own", async () => {
    // 60 places by someone else are closer than Bo's one place.
    const others = Array.from({ length: 60 }, (_, i) => ({ id: `x-${i}`, name: `Other ${i}`, is_library: false, created_by: "ada", deleted_at: null }));
    const asked: Row[] = [];
    installDouble(
      { locations: [...others, { id: "l-bo", name: "Bo's bench", is_library: false, created_by: "bo", deleted_at: null }] },
      {
        rpc: {
          nearby_locations: (args) => {
            asked.push(args);
            return [...others, { id: "l-bo" }].slice(0, Number(args.max_results)).map((l) => ({ id: l.id }));
          },
        },
      }
    );
    h.user = bo;
    const body = await (await listLocations(req("/locations?lat=40.25&lng=-111.65"))).json();
    expect(body.locations.map((l: Row) => l.id)).toEqual(["l-bo"]);
    expect(Number(asked[0].max_results)).toBeGreaterThan(60);

    // An admin sees every place, capped at the usual page.
    h.user = admin;
    const all = await (await listLocations(req("/locations?lat=40.25&lng=-111.65"))).json();
    expect(all.locations).toHaveLength(50);
  });
});
