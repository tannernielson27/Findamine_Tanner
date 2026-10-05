import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Route-level tests for the hunt builder + roster APIs a teacher uses to set up
 * a pilot: cloning, stop CRUD, publishing, analytics, and roster membership.
 */

type Result = { data: unknown; error: unknown };
type Query = Record<string, ReturnType<typeof vi.fn>> & { then: unknown };

/** A chainable stand-in for one PostgREST query that resolves to `result`. */
function query(result: Result): Query {
  const q = {} as Query;
  for (const m of ["select", "insert", "update", "delete", "eq", "in", "is", "order", "limit"]) {
    q[m] = vi.fn(() => q);
  }
  q.single = vi.fn(async () => result);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

const h = vi.hoisted(() => ({
  service: null as unknown as { from: ReturnType<typeof vi.fn> },
  user: null as null | { id: string; role: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => h.service,
}));
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  generalLimiter: { check: async () => {} },
}));

import { parseFindFields } from "@/app/api/v1/hunts/find-fields";
import { parseCoordinates, parseRadius } from "@/app/api/v1/locations/validation";
import { GET as getHunt } from "@/app/api/v1/hunts/[id]/route";
import { POST as cloneHunt } from "@/app/api/v1/hunts/[id]/clone/route";
import { POST as publishHunt } from "@/app/api/v1/hunts/[id]/publish/route";
import { POST as addFind } from "@/app/api/v1/hunts/[id]/finds/route";
import { DELETE as deleteFind } from "@/app/api/v1/hunts/[id]/finds/[findId]/route";
import { GET as getAnalytics } from "@/app/api/v1/hunts/[id]/analytics/route";
import { GET as getRoster, DELETE as deleteRoster } from "@/app/api/v1/roster/[id]/route";
import { POST as addMember, DELETE as removeMember } from "@/app/api/v1/roster/[id]/members/route";

/** Queue one result per `from(table)` call, in call order. */
function install(queue: Record<string, Result[]>) {
  const made: Record<string, Query[]> = {};
  h.service = {
    from: vi.fn((table: string) => {
      const q = query(queue[table]?.shift() ?? { data: null, error: null });
      (made[table] ||= []).push(q);
      return q;
    }),
  };
  return made;
}

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const HUNT_ID = "11111111-1111-4111-8111-111111111111";
const huntParams = { params: Promise.resolve({ id: HUNT_ID }) };
const ok = (data: unknown): Result => ({ data, error: null });

beforeEach(() => {
  h.user = { id: "teacher-1", role: "teacher" };
});

describe("parseFindFields", () => {
  it("keeps scaffolding_level and clue_hints (they used to be dropped)", () => {
    const fields = parseFindFields({
      scaffolding_level: "low",
      clue_hints: ["near the fountain", "", 7, "look up"],
      clue_text: "Find the fountain",
    });
    expect(fields).toEqual({
      scaffolding_level: "low",
      clue_hints: ["near the fountain", "look up"],
      clue_text: "Find the fountain",
    });
  });

  it("only returns fields that were sent, so PUT stays a partial update", () => {
    expect(parseFindFields({ sort_order: 2 })).toEqual({ sort_order: 2 });
  });

  it("rejects values the finds table would refuse", () => {
    expect(() => parseFindFields({ scaffolding_level: "extreme" })).toThrow(/high, medium, or low/);
    expect(() => parseFindFields({ sort_order: -1 })).toThrow(/sort_order/);
    expect(() => parseFindFields({ clue_hints: "one hint" })).toThrow(/clue_hints/);
  });
});

describe("location validation", () => {
  it("rejects the (0, 0) placeholder and out-of-range coordinates", () => {
    expect(() => parseCoordinates(0, 0)).toThrow(/not a real location/);
    expect(() => parseCoordinates(undefined, 5)).toThrow(/required/);
    expect(() => parseCoordinates(91, 5)).toThrow(/Invalid coordinates/);
    expect(parseCoordinates("40.25", "-111.65")).toEqual({ lat: 40.25, lng: -111.65 });
    // A legitimately-zero longitude is fine as long as it is not (0, 0).
    expect(parseCoordinates(51.48, 0)).toEqual({ lat: 51.48, lng: 0 });
  });

  it("rejects zero, negative and huge radii instead of silently substituting 50", () => {
    expect(parseRadius(undefined)).toBeUndefined();
    expect(parseRadius(30)).toBe(30);
    expect(() => parseRadius(0)).toThrow(/between 5 and 1000/);
    expect(() => parseRadius(-20)).toThrow(/between 5 and 1000/);
    expect(() => parseRadius(50000)).toThrow(/between 5 and 1000/);
  });
});

describe("GET /hunts/{id}", () => {
  it("leaves out soft-deleted stops and sorts the rest", async () => {
    install({
      hunts: [ok({
        id: HUNT_ID, status: "published", created_by: "teacher-1",
        finds: [
          { id: "f3", sort_order: 2, deleted_at: null },
          { id: "f2", sort_order: 1, deleted_at: "2026-01-01T00:00:00Z" },
          { id: "f1", sort_order: 0, deleted_at: null },
        ],
      })],
    });
    const res = await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams);
    const body = await res.json();
    expect(body.hunt.finds.map((f: { id: string }) => f.id)).toEqual(["f1", "f3"]);
  });
});

describe("POST /hunts/{id}/clone", () => {
  const source = {
    id: HUNT_ID, title: "Campus Walk", status: "published", is_public: true,
    created_by: "someone-else", created_at: "x", updated_at: "y", deleted_at: null,
    search_vector: "'campus':1 'walk':2", metadata: { scoring_mode: "binary" },
    finds: [
      { id: "f-live", hunt_id: HUNT_ID, sort_order: 4, clue_text: "A", location_id: "l1", task_id: "t1", primer_id: null, deleted_at: null, created_at: "x", updated_at: "y", locations: {}, tasks: {}, primers: null },
      { id: "f-gone", hunt_id: HUNT_ID, sort_order: 1, clue_text: "B", location_id: "l2", task_id: "t2", primer_id: null, deleted_at: "2026-01-01T00:00:00Z", created_at: "x", updated_at: "y", locations: {}, tasks: {}, primers: null },
    ],
  };

  it("does not re-insert the generated search_vector column, and skips removed stops", async () => {
    const made = install({ hunts: [ok(source), ok({ id: "new-hunt", title: "Campus Walk (Copy)" })] });

    const res = await cloneHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/clone`), huntParams);
    expect(res.status).toBe(201);

    const huntInsert = made.hunts[1].insert.mock.calls[0][0];
    expect(huntInsert).not.toHaveProperty("search_vector");
    expect(huntInsert).not.toHaveProperty("id");
    expect(huntInsert).not.toHaveProperty("finds");
    expect(huntInsert).toMatchObject({
      title: "Campus Walk (Copy)", status: "draft", is_public: false,
      created_by: "teacher-1", source_template_id: HUNT_ID, metadata: { scoring_mode: "binary" },
    });

    expect(made.finds).toHaveLength(1);
    const findInsert = made.finds[0].insert.mock.calls[0][0];
    expect(findInsert).toMatchObject({ hunt_id: "new-hunt", clue_text: "A", location_id: "l1", task_id: "t1", sort_order: 0 });
    expect(findInsert).not.toHaveProperty("id");
    expect(findInsert).not.toHaveProperty("locations");
  });

  it("reports a failed stop copy and removes the half-made hunt", async () => {
    const made = install({
      hunts: [ok(source), ok({ id: "new-hunt" }), ok(null)],
      finds: [{ data: null, error: { message: "boom" } }],
    });

    const res = await cloneHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/clone`), huntParams);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Failed to copy stop 1: boom/);
    expect(made.hunts[2].delete).toHaveBeenCalled();
    expect(made.hunts[2].eq).toHaveBeenCalledWith("id", "new-hunt");
  });

  it("will not clone someone else's unpublished draft", async () => {
    install({ hunts: [ok({ ...source, status: "draft" })] });
    const res = await cloneHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/clone`), huntParams);
    expect(res.status).toBe(404);
  });
});

describe("POST /hunts/{id}/finds", () => {
  it("saves scaffolding_level + clue_hints and orders the stop after the current last one", async () => {
    const made = install({
      hunts: [ok({ created_by: "teacher-1" })],
      // Two live stops remain after a delete, but the last one sits at sort_order 5.
      finds: [ok([{ sort_order: 5 }]), ok({ id: "new-find" })],
    });

    const res = await addFind(
      req("POST", `/api/v1/hunts/${HUNT_ID}/finds`, {
        location_id: "l1", task_id: "t1", clue_text: "Go", scaffolding_level: "high", clue_hints: ["h1"],
      }),
      huntParams
    );
    expect(res.status).toBe(201);
    expect(made.finds[1].insert.mock.calls[0][0]).toMatchObject({
      hunt_id: HUNT_ID, sort_order: 6, scaffolding_level: "high", clue_hints: ["h1"], hot_cold_enabled: true,
    });
  });

  it("refuses to add stops to another creator's hunt", async () => {
    install({ hunts: [ok({ created_by: "someone-else" })] });
    const res = await addFind(req("POST", `/api/v1/hunts/${HUNT_ID}/finds`, { clue_text: "x" }), huntParams);
    expect(res.status).toBe(403);
  });
});

describe("DELETE /hunts/{id}/finds/{findId}", () => {
  it("says so when the stop is not part of this hunt", async () => {
    install({ hunts: [ok({ created_by: "teacher-1" })], finds: [ok([])] });
    const res = await deleteFind(req("DELETE", `/api/v1/hunts/${HUNT_ID}/finds/f9`), {
      params: Promise.resolve({ id: HUNT_ID, findId: "f9" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /hunts/{id}/publish", () => {
  it("explains that a hunt with no stops cannot be published", async () => {
    install({ hunts: [ok({ created_by: "teacher-1" })], finds: [ok([])] });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`), huntParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/at least one stop/);
  });

  it("blocks publishing while AI-generated stops still have placeholder locations", async () => {
    install({
      hunts: [ok({ created_by: "teacher-1" })],
      finds: [ok([
        { id: "a", location_id: "l1", metadata: {} },
        { id: "b", location_id: "l2", metadata: { needs_placement: true } },
        { id: "c", location_id: null, metadata: {} },
      ])],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`), huntParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/stop 3 has no location/);

    install({
      hunts: [ok({ created_by: "teacher-1" })],
      finds: [ok([
        { id: "a", location_id: "l1", metadata: { needs_placement: true } },
        { id: "b", location_id: "l2", metadata: { needs_placement: true } },
      ])],
    });
    const placeholder = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`), huntParams);
    expect(placeholder.status).toBe(400);
    expect((await placeholder.json()).error).toMatch(/stops 1, 2 have a placeholder location/);
  });

  it("publishes once every stop has a real location", async () => {
    const made = install({
      hunts: [ok({ created_by: "teacher-1" }), ok({ id: HUNT_ID, status: "published" })],
      finds: [ok([{ id: "a", location_id: "l1", metadata: { needs_placement: false } }])],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`), huntParams);
    expect(res.status).toBe(200);
    expect(made.hunts[1].update).toHaveBeenCalledWith({ status: "published", is_public: true });
  });
});

describe("GET /hunts/{id}/analytics", () => {
  it("numbers stops in hunt order and includes stops nobody has played", async () => {
    install({
      hunts: [ok({ id: HUNT_ID, title: "Walk", created_by: "teacher-1", status: "published" })],
      play_sessions: [
        ok([{ id: "s1", total_score: 80, status: "completed", started_at: "2026-01-01T10:00:00Z", completed_at: "2026-01-01T10:30:00Z" }]),
        { data: null, error: null },
      ],
      finds: [ok([
        { id: "first", sort_order: 0, locations: { name: "Fountain" } },
        { id: "second", sort_order: 1, locations: { name: "Library" } },
        { id: "third", sort_order: 2, locations: null },
      ])],
      // Completions arrive in play order, which is NOT hunt order.
      find_completions: [ok([
        { find_id: "third", score: 40, hints_used: 1, clue_hints_used: 0, challenge_hints_used: 1, completed_at: "t" },
        { find_id: "first", score: 90, hints_used: 0, clue_hints_used: 0, challenge_hints_used: 0, completed_at: "t" },
      ])],
    });

    const res = await getAnalytics(req("GET", `/api/v1/hunts/${HUNT_ID}/analytics`), huntParams);
    const body = await res.json();

    expect(body.stops).toEqual([
      { find_id: "first", stop_number: 1, name: "Fountain", avg_score: 90, avg_hints: 0, completion_count: 1 },
      { find_id: "second", stop_number: 2, name: "Library", avg_score: null, avg_hints: null, completion_count: 0 },
      { find_id: "third", stop_number: 3, name: null, avg_score: 40, avg_hints: 2, completion_count: 1 },
    ]);
    expect(body.hardest_stop.stop_number).toBe(3);
    expect(body.easiest_stop.stop_number).toBe(1);
  });
});

describe("roster routes", () => {
  const rosterParams = { params: Promise.resolve({ id: "r1" }) };

  it("GET /roster/{id} returns the owner's roster with members", async () => {
    install({
      rosters: [
        ok({ id: "r1", teacher_id: "teacher-1" }),
        ok({ id: "r1", name: "Period 3", roster_entries: [{ student_id: "s1", users: { id: "s1", display_name: "Ada" } }] }),
      ],
    });
    const res = await getRoster(req("GET", "/api/v1/roster/r1"), rosterParams);
    expect(res.status).toBe(200);
    expect((await res.json()).roster.roster_entries).toHaveLength(1);
  });

  it("GET /roster/{id} is refused for another teacher and for non-teacher roles", async () => {
    install({ rosters: [ok({ id: "r1", teacher_id: "someone-else" })] });
    expect((await getRoster(req("GET", "/api/v1/roster/r1"), rosterParams)).status).toBe(403);

    h.user = { id: "u2", role: "researcher" };
    install({});
    expect((await getRoster(req("GET", "/api/v1/roster/r1"), rosterParams)).status).toBe(403);
  });

  it("DELETE /roster/{id} soft-deletes and retires the join code", async () => {
    const made = install({ rosters: [ok({ id: "r1", teacher_id: "teacher-1" }), ok(null)] });
    const res = await deleteRoster(req("DELETE", "/api/v1/roster/r1"), rosterParams);
    expect(res.status).toBe(200);
    expect(made.rosters[1].update.mock.calls[0][0]).toMatchObject({ join_code: null });
    expect(made.rosters[1].update.mock.calls[0][0].deleted_at).toEqual(expect.any(String));
  });

  it("adds a student by email", async () => {
    const made = install({
      rosters: [ok({ id: "r1", teacher_id: "teacher-1" })],
      users: [ok([{ id: "student-9" }])],
      roster_entries: [ok({ id: "e1", roster_id: "r1", student_id: "student-9" })],
    });
    const res = await addMember(req("POST", "/api/v1/roster/r1/members", { email: " Ada@School.org " }), rosterParams);
    expect(res.status).toBe(201);
    expect(made.users[0].in).toHaveBeenCalledWith("email", ["ada@school.org", "Ada@School.org"]);
    expect(made.roster_entries[0].insert).toHaveBeenCalledWith({ roster_id: "r1", student_id: "student-9" });
  });

  it("tells the teacher when no account uses that email", async () => {
    const made = install({ rosters: [ok({ id: "r1", teacher_id: "teacher-1" })], users: [ok([])] });
    const res = await addMember(req("POST", "/api/v1/roster/r1/members", { email: "nobody@school.org" }), rosterParams);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatch(/No account uses that email/);
    expect(made.roster_entries).toBeUndefined();
  });

  it("will not let a teacher edit another teacher's roster", async () => {
    install({ rosters: [ok({ id: "r1", teacher_id: "someone-else" })] });
    const res = await addMember(req("POST", "/api/v1/roster/r1/members", { student_id: "s1" }), rosterParams);
    expect(res.status).toBe(403);
  });

  it("reports removing a student who is not in the roster", async () => {
    install({ rosters: [ok({ id: "r1", teacher_id: "teacher-1" })], roster_entries: [ok([])] });
    const res = await removeMember(req("DELETE", "/api/v1/roster/r1/members?student_id=s1"), rosterParams);
    expect(res.status).toBe(404);
  });
});
