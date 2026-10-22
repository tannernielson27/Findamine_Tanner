import { describe, it, expect, vi, beforeEach } from "vitest";
// after() needs a live Next request scope; reviewer alerts are covered in report-alerts.test.ts.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));
import { NextRequest } from "next/server";

/**
 * Publish review (migration 073): publishing submits a hunt for review instead
 * of listing it; reviewers approve/reject; only approved hunts are public;
 * edits after approval send a hunt back to review; anonymous visitors don't
 * get review text.
 */

type Result = { data: unknown; error: unknown };
type Query = Record<string, ReturnType<typeof vi.fn>> & { then: unknown };

/** A chainable stand-in for one PostgREST query that resolves to `result`. */
function query(result: Result): Query {
  const q = {} as Query;
  for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "in", "is", "or", "order", "limit", "textSearch"]) {
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
  publishLimiter: { check: async () => {} },
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST as publishHunt } from "@/app/api/v1/hunts/[id]/publish/route";
import { POST as unpublishHunt } from "@/app/api/v1/hunts/[id]/unpublish/route";
import { POST as reviewHunt } from "@/app/api/v1/hunts/[id]/review/route";
import { GET as reviewQueue } from "@/app/api/v1/hunts/review-queue/route";
import { GET as listHunts } from "@/app/api/v1/hunts/route";
import { GET as getHunt, PUT as putHunt } from "@/app/api/v1/hunts/[id]/route";
import { POST as addFind } from "@/app/api/v1/hunts/[id]/finds/route";
import { PUT as putFind } from "@/app/api/v1/hunts/[id]/finds/[findId]/route";
import { GET as getRatings } from "@/app/api/v1/hunts/[id]/rate/route";
import { canAccessHunt } from "@/lib/hunts/review";

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
const findParams = { params: Promise.resolve({ id: HUNT_ID, findId: "f1" }) };
const ok = (data: unknown): Result => ({ data, error: null });
const AFFIRMED = { safety_affirmed: true };
const PLAYABLE_STOP = { id: "a", location_id: "l1", metadata: {}, clue_text: "By the old oak", clue_hints: [] };

beforeEach(() => {
  h.user = { id: "teacher-1", role: "teacher" };
});

describe("POST /hunts/{id}/publish", () => {
  it("requires the creator's safety affirmation", async () => {
    const made = install({ hunts: [ok({ created_by: "teacher-1", status: "draft" })] });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`, {}), huntParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/safe, accessible ground/);
    expect(made.hunts).toHaveLength(1);
  });

  it("submits a creator's hunt for review: playable but not listed, affirmation recorded", async () => {
    const made = install({
      hunts: [ok({ created_by: "teacher-1", status: "draft", title: "Campus Walk" }), ok({ id: HUNT_ID })],
      finds: [ok([PLAYABLE_STOP])],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`, AFFIRMED), huntParams);
    expect(res.status).toBe(200);
    expect((await res.json()).review_status).toBe("pending");
    const update = made.hunts[1].update.mock.calls[0][0];
    expect(update).toMatchObject({
      status: "published",
      is_public: false,
      review_status: "pending",
      reviewed_by: null,
      safety_affirmed_by: "teacher-1",
    });
    expect(update.safety_affirmed_at).toEqual(expect.any(String));
    expect(update.review_submitted_at).toEqual(expect.any(String));
  });

  it("approves a reviewer's own publish immediately", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install({
      hunts: [ok({ created_by: "admin-1", status: "draft", title: "Library Loop" }), ok({ id: HUNT_ID })],
      finds: [ok([PLAYABLE_STOP])],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`, AFFIRMED), huntParams);
    expect(res.status).toBe(200);
    expect(made.hunts[1].update.mock.calls[0][0]).toMatchObject({
      status: "published",
      is_public: true,
      review_status: "approved",
      reviewed_by: "admin-1",
    });
  });

  it("rejects objectionable text up front and names where it is", async () => {
    const made = install({
      hunts: [ok({ created_by: "teacher-1", status: "draft", title: "Fun walk" })],
      finds: [ok([PLAYABLE_STOP, { ...PLAYABLE_STOP, id: "b", clue_text: "go to the fucking bench" }])],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`, AFFIRMED), huntParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/stop 2's clue/);
    expect(made.hunts).toHaveLength(1);
  });

  it("screens task and primer text on the stops too", async () => {
    install({
      hunts: [ok({ created_by: "teacher-1", status: "draft", title: "Fun walk" })],
      finds: [ok([{ ...PLAYABLE_STOP, tasks: { title: "Q", content: { question: "what a shit day" } } }])],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`, AFFIRMED), huntParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/stop 1's challenge/);
  });

  it("leaves an already-approved live hunt alone instead of requeueing it", async () => {
    const made = install({
      hunts: [ok({ id: HUNT_ID, created_by: "teacher-1", status: "published", review_status: "approved" })],
    });
    const res = await publishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/publish`, AFFIRMED), huntParams);
    expect(res.status).toBe(200);
    expect((await res.json()).review_status).toBe("approved");
    expect(made.hunts).toHaveLength(1);
  });
});

describe("POST /hunts/{id}/unpublish", () => {
  it("takes the hunt out of the review queue as well as the catalogue", async () => {
    const made = install({ hunts: [ok({ created_by: "teacher-1" }), ok({ id: HUNT_ID })] });
    const res = await unpublishHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/unpublish`), huntParams);
    expect(res.status).toBe(200);
    expect(made.hunts[1].update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "draft", is_public: false, review_status: "not_submitted" })
    );
  });
});

describe("POST /hunts/{id}/review", () => {
  const SUBMITTED = "2026-10-01T12:00:00.000Z";
  const pending = {
    id: HUNT_ID, title: "Campus Walk", status: "published", review_status: "pending",
    review_submitted_at: "2026-10-01T12:00:00+00:00", created_by: "teacher-1",
  };
  const decide = (body: Record<string, unknown>) =>
    reviewHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/review`, { review_submitted_at: SUBMITTED, ...body }), huntParams);

  it("is for reviewers only", async () => {
    install({});
    const res = await decide({ decision: "approve" });
    expect(res.status).toBe(403);
  });

  it("approves: lists the hunt and notifies the creator", async () => {
    h.user = { id: "res-1", role: "researcher" };
    const made = install({ hunts: [ok(pending), ok({ id: HUNT_ID })], notifications: [ok(null)] });
    const res = await decide({ decision: "approve" });
    expect(res.status).toBe(200);
    expect(made.hunts[1].update.mock.calls[0][0]).toMatchObject({
      review_status: "approved",
      is_public: true,
      reviewed_by: "res-1",
    });
    // Conditional on the version the reviewer saw (M7).
    expect(made.hunts[1].eq).toHaveBeenCalledWith("review_status", "pending");
    expect(made.hunts[1].eq).toHaveBeenCalledWith("review_submitted_at", pending.review_submitted_at);
    expect(made.notifications[0].insert.mock.calls[0][0]).toMatchObject({
      user_id: "teacher-1",
      type: "hunt_review_approved",
      entity_type: "hunt",
      entity_id: HUNT_ID,
    });
  });

  it("requires a reason to reject, then unlists and tells the creator why", async () => {
    h.user = { id: "admin-1", role: "admin" };
    install({ hunts: [ok(pending)] });
    const noReason = await decide({ decision: "reject" });
    expect(noReason.status).toBe(400);

    const made = install({ hunts: [ok(pending), ok({ id: HUNT_ID })], notifications: [ok(null)] });
    const res = await decide({ decision: "reject", reason: "Stop 2 is on private land." });
    expect(res.status).toBe(200);
    expect(made.hunts[1].update.mock.calls[0][0]).toMatchObject({
      review_status: "rejected",
      is_public: false,
      review_reason: "Stop 2 is on private land.",
    });
    const note = made.notifications[0].insert.mock.calls[0][0];
    expect(note).toMatchObject({ user_id: "teacher-1", type: "hunt_review_rejected" });
    expect(note.body).toContain("Stop 2 is on private land.");
    // A rejected hunt no longer reaches the creator's classes (M6).
    expect(note.body).not.toMatch(/classes/);
    expect(note.body).toMatch(/only you can open it/);
  });

  it("refuses to review a hunt that went back to draft", async () => {
    h.user = { id: "admin-1", role: "admin" };
    install({ hunts: [ok({ ...pending, status: "draft" })] });
    const res = await decide({ decision: "approve" });
    expect(res.status).toBe(409);
  });

  it("requires the submission time the reviewer saw", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install({ hunts: [ok(pending)] });
    const res = await reviewHunt(req("POST", `/api/v1/hunts/${HUNT_ID}/review`, { decision: "approve" }), huntParams);
    expect(res.status).toBe(400);
    expect(made.hunts ?? []).toHaveLength(0);
  });

  it("refuses (409) when the hunt was edited after the reviewer loaded it", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install({ hunts: [ok({ ...pending, review_submitted_at: "2026-10-01T12:05:00+00:00" })] });
    const res = await decide({ decision: "approve" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/changed since you loaded it/);
    expect(made.hunts).toHaveLength(1);
  });

  it("refuses (409) when an edit lands between the check and the write", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install({ hunts: [ok(pending), ok(null)] });
    const res = await decide({ decision: "approve" });
    expect(res.status).toBe(409);
    expect(made.notifications).toBeUndefined();
  });

  it("only approves pending hunts, and only rejects pending or listed ones", async () => {
    h.user = { id: "admin-1", role: "admin" };
    install({ hunts: [ok({ ...pending, review_status: "rejected" })] });
    expect((await decide({ decision: "approve" })).status).toBe(409);
    install({ hunts: [ok({ ...pending, review_status: "approved" })] });
    expect((await decide({ decision: "approve" })).status).toBe(409);
    install({ hunts: [ok({ ...pending, review_status: "not_submitted" })] });
    expect((await decide({ decision: "reject", reason: "no" })).status).toBe(409);

    // Take-down of a listed hunt is allowed.
    const made = install({
      hunts: [ok({ ...pending, review_status: "approved" }), ok({ id: HUNT_ID })],
      notifications: [ok(null)],
    });
    expect((await decide({ decision: "reject", reason: "Unsafe stop" })).status).toBe(200);
    expect(made.hunts[1].update.mock.calls[0][0]).toMatchObject({ review_status: "rejected", is_public: false });
  });
});

describe("GET /hunts/review-queue", () => {
  it("lists pending hunts with their live stops in order, for reviewers only", async () => {
    install({});
    expect((await reviewQueue(req("GET", "/api/v1/hunts/review-queue"))).status).toBe(403);

    h.user = { id: "admin-1", role: "admin" };
    const made = install({
      hunts: [ok([{
        id: HUNT_ID, title: "Walk",
        finds: [
          { sort_order: 1, clue_text: "second", deleted_at: null },
          { sort_order: 0, clue_text: "first", deleted_at: null },
          { sort_order: 2, clue_text: "gone", deleted_at: "2026-01-01" },
        ],
      }])],
    });
    const res = await reviewQueue(req("GET", "/api/v1/hunts/review-queue"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hunts[0].finds.map((f: { clue_text: string }) => f.clue_text)).toEqual(["first", "second"]);
    expect(made.hunts[0].eq).toHaveBeenCalledWith("review_status", "pending");
  });

  it("retries once without hunts.cover_image_url when the column doesn't exist yet (42703)", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install({
      hunts: [
        { data: null, error: { code: "42703", message: "column hunts.cover_image_url does not exist" } },
        ok([{ id: HUNT_ID, title: "Walk", finds: [{ sort_order: 0, clue_text: "first", deleted_at: null }] }]),
      ],
    });
    const res = await reviewQueue(req("GET", "/api/v1/hunts/review-queue"));
    expect(res.status).toBe(200);
    expect((await res.json()).hunts[0].title).toBe("Walk");
    expect(made.hunts).toHaveLength(2);
    expect(made.hunts[0].select.mock.calls[0][0]).toContain("cover_image_url");
    expect(made.hunts[1].select.mock.calls[0][0]).not.toContain("cover_image_url");
    expect(made.hunts[1].eq).toHaveBeenCalledWith("review_status", "pending");
  });

  it("does not retry other query errors", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install({ hunts: [{ data: null, error: { code: "57014", message: "statement timeout" } }] });
    const res = await reviewQueue(req("GET", "/api/v1/hunts/review-queue"));
    expect(res.status).toBe(500);
    expect(made.hunts).toHaveLength(1);
  });

  it("shows reviewers everything a player of each stop reads", async () => {
    h.user = { id: "admin-1", role: "admin" };
    install({
      hunts: [ok([{
        id: HUNT_ID, title: "Walk", review_submitted_at: "2026-10-01T12:00:00+00:00",
        finds: [{
          sort_order: 0, clue_text: "By the oak", clue_hints: ["Look up", { text: "North side" }], deleted_at: null,
          tasks: {
            title: "Count", description: "Count the rings",
            content: { question: "How many?", options: ["3", "4"] },
            feedback: { correct: "Nice!" }, challenge_type: "multiple_choice",
          },
          primers: [{ title: "Oaks", content: { body: "Oaks are old." } }],
          locations: { name: "Quad", description: "Grass", address: "1 Main St", safety_notes: "Watch for bikes" },
        }],
      }])],
    });
    const body = await (await reviewQueue(req("GET", "/api/v1/hunts/review-queue"))).json();
    expect(body.hunts[0].review_submitted_at).toBe("2026-10-01T12:00:00+00:00");
    expect(body.hunts[0].finds[0]).toEqual({
      sort_order: 0,
      clue_text: "By the oak",
      hints: ["Look up", "North side"],
      task: {
        title: "Count", description: "Count the rings", challenge_type: "multiple_choice",
        content: ["How many?", "3", "4"], feedback: ["Nice!"],
      },
      primer: { title: "Oaks", content: ["Oaks are old."] },
      place: { name: "Quad", description: "Grass", address: "1 Main St", safety_notes: "Watch for bikes" },
    });
  });
});

describe("public catalogue", () => {
  it("only lists public (= approved) hunts", async () => {
    h.user = null;
    const made = install({ hunts: [ok([])] });
    const res = await listHunts(req("GET", "/api/v1/hunts"));
    expect(res.status).toBe(200);
    expect(made.hunts[0].eq).toHaveBeenCalledWith("is_public", true);
  });

  it("hides a pending hunt's detail from the public but not from its creator", async () => {
    const hunt = { id: HUNT_ID, status: "published", review_status: "pending", created_by: "teacher-1", finds: [] };

    h.user = null;
    install({ hunts: [ok(hunt)] });
    expect((await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams)).status).toBe(404);

    h.user = { id: "stranger", role: "player" };
    install({ hunts: [ok(hunt)], roster_entries: [ok([])] });
    expect((await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams)).status).toBe(404);

    h.user = { id: "teacher-1", role: "teacher" };
    install({ hunts: [ok(hunt)] });
    expect((await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams)).status).toBe(200);
  });

  it("strips internal review fields for players, keeps them for the creator and reviewers (L6)", async () => {
    const hunt = {
      id: HUNT_ID, status: "published", review_status: "approved", created_by: "teacher-1", finds: [],
      review_reason: "ok", reviewed_by: "admin-1", reviewed_at: "x", review_submitted_at: "y",
      safety_affirmed_by: "teacher-1", safety_affirmed_at: "z",
    };
    const internal = [
      "review_reason", "reviewed_by", "reviewed_at", "review_submitted_at", "safety_affirmed_by", "safety_affirmed_at",
    ];

    h.user = { id: "player-1", role: "player" };
    install({ hunts: [ok(hunt)] });
    const forPlayer = (await (await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams)).json()).hunt;
    for (const field of internal) expect(forPlayer).not.toHaveProperty(field);
    expect(forPlayer.review_status).toBe("approved");

    h.user = null;
    install({ hunts: [ok(hunt)] });
    const forAnon = (await (await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams)).json()).hunt;
    expect(forAnon).not.toHaveProperty("reviewed_by");

    for (const viewer of [{ id: "teacher-1", role: "teacher" }, { id: "res-1", role: "researcher" }]) {
      h.user = viewer;
      install({ hunts: [ok(hunt)] });
      const seen = (await (await getHunt(req("GET", `/api/v1/hunts/${HUNT_ID}`), huntParams)).json()).hunt;
      expect(seen.reviewed_by).toBe("admin-1");
      expect(seen.safety_affirmed_by).toBe("teacher-1");
    }
  });
});

describe("canAccessHunt", () => {
  const client = () => h.service as unknown as Parameters<typeof canAccessHunt>[0];
  const pending = { created_by: "teacher-1", status: "published", review_status: "pending" };

  it("lets anyone open an approved hunt", async () => {
    install({});
    expect(await canAccessHunt(client(), { ...pending, review_status: "approved" }, null)).toBe(true);
  });

  it("lets the creator's roster students play a pending hunt, but not strangers", async () => {
    install({ roster_entries: [ok([{ roster_id: "r1" }])] });
    expect(await canAccessHunt(client(), pending, { id: "student-1", role: "player" })).toBe(true);

    install({ roster_entries: [ok([])] });
    expect(await canAccessHunt(client(), pending, { id: "stranger", role: "player" })).toBe(false);
    expect(await canAccessHunt(client(), pending, null)).toBe(false);
  });

  it("keeps a rejected hunt away from roster students, but not from its creator or reviewers (M6)", async () => {
    const rejected = { ...pending, review_status: "rejected" };
    const made = install({ roster_entries: [ok([{ roster_id: "r1" }])] });
    expect(await canAccessHunt(client(), rejected, { id: "student-1", role: "player" })).toBe(false);
    expect(made.roster_entries ?? []).toHaveLength(0);
    expect(await canAccessHunt(client(), rejected, { id: "teacher-1", role: "teacher" })).toBe(true);
    expect(await canAccessHunt(client(), rejected, { id: "admin-1", role: "admin" })).toBe(true);
  });

  it("lets reviewers open any hunt, and keeps drafts away from roster students", async () => {
    install({ roster_entries: [ok([{ roster_id: "r1" }])] });
    expect(await canAccessHunt(client(), pending, { id: "res-1", role: "researcher" })).toBe(true);
    expect(
      await canAccessHunt(client(), { ...pending, status: "draft" }, { id: "student-1", role: "player" })
    ).toBe(false);
  });
});

describe("edit after approval", () => {
  const approved = {
    created_by: "teacher-1", status: "published", review_status: "approved",
    title: "Campus Walk", description: "A walk", theme: null, theme_narrative: null,
  };

  it("sends a listed hunt back for review when its text changes, and says so", async () => {
    const made = install({
      hunts: [ok(approved), ok({ id: HUNT_ID, title: "Campus Walk 2" }), ok([{ id: HUNT_ID }]), ok({ review_status: "pending" })],
    });
    const res = await putHunt(req("PUT", `/api/v1/hunts/${HUNT_ID}`, { title: "Campus Walk 2" }), huntParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.review_status).toBe("pending");
    expect(body.hunt.is_public).toBe(false);
    expect(body.message).toMatch(/back for review/);
    expect(made.hunts[2].update.mock.calls[0][0]).toMatchObject({ review_status: "pending", is_public: false });
    expect(made.hunts[2].eq).toHaveBeenCalledWith("review_status", "approved");
  });

  it("requeues when reviewed settings change (audience, play mode, place), not only text (M5)", async () => {
    const changes = [{ target_audience: "adults" }, { play_mode: "team_assigned" }, { center_latitude: 41 }, { grade_range_max: 12 }];
    for (const change of changes) {
      const made = install({
        hunts: [
          ok({ ...approved, target_audience: "kids", play_mode: "solo", center_latitude: 40, grade_range_max: 6 }),
          ok({ id: HUNT_ID }),
          ok([{ id: HUNT_ID }]),
          ok({ review_status: "pending" }),
        ],
      });
      const res = await putHunt(req("PUT", `/api/v1/hunts/${HUNT_ID}`, change), huntParams);
      expect((await res.json()).review_status).toBe("pending");
      expect(made.hunts[2].update.mock.calls[0][0]).toMatchObject({ review_status: "pending" });
    }
  });

  it("reports a requeue the database made even when the route didn't predict it", async () => {
    const made = install({ hunts: [ok(approved), ok({ id: HUNT_ID }), ok({ review_status: "pending" })] });
    const res = await putHunt(req("PUT", `/api/v1/hunts/${HUNT_ID}`, { estimated_duration_min: 45 }), huntParams);
    expect((await res.json()).review_status).toBe("pending");
    expect(made.hunts).toHaveLength(3);
  });

  it("words the requeue message for an admin editing someone else's hunt", async () => {
    h.user = { id: "admin-1", role: "admin" };
    install({ hunts: [ok(approved), ok({ id: HUNT_ID }), ok([{ id: HUNT_ID }]), ok({ review_status: "pending" })] });
    const body = await (await putHunt(req("PUT", `/api/v1/hunts/${HUNT_ID}`, { title: "New" }), huntParams)).json();
    expect(body.message).toMatch(/sent it back for review/);
    expect(body.message).not.toMatch(/your edit/);
  });

  it("keeps the listing when the text sent is unchanged or not reviewed", async () => {
    const made = install({ hunts: [ok(approved), ok({ id: HUNT_ID }), ok({ review_status: "approved" })] });
    const res = await putHunt(
      req("PUT", `/api/v1/hunts/${HUNT_ID}`, { title: "Campus Walk", estimated_duration_min: 30 }),
      huntParams
    );
    expect(res.status).toBe(200);
    expect((await res.json()).review_status).toBeUndefined();
    // Only the save and the status re-read: no requeue write.
    expect(made.hunts).toHaveLength(3);
    expect(made.hunts[2].update).not.toHaveBeenCalled();
  });

  it("filters edited hunt text", async () => {
    const made = install({ hunts: [ok(approved)] });
    const res = await putHunt(req("PUT", `/api/v1/hunts/${HUNT_ID}`, { description: "some bullshit" }), huntParams);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/The description/);
    expect(made.hunts).toHaveLength(1);
  });

  it("requeues when a stop's clue changes, not when it is only reordered", async () => {
    let made = install({
      hunts: [ok(approved), ok([{ id: HUNT_ID }]), ok({ review_status: "pending" })],
      finds: [ok({ clue_text: "old clue", clue_hints: [], task_id: "t1", primer_id: null }), ok({ id: "f1" })],
    });
    let res = await putFind(req("PUT", `/api/v1/hunts/${HUNT_ID}/finds/f1`, { clue_text: "new clue" }), findParams);
    expect(res.status).toBe(200);
    expect((await res.json()).review_status).toBe("pending");
    expect(made.hunts[1].update.mock.calls[0][0]).toMatchObject({ review_status: "pending" });

    made = install({
      hunts: [ok(approved), ok({ review_status: "approved" })],
      finds: [ok({ clue_text: "old clue", clue_hints: [], task_id: "t1", primer_id: null }), ok({ id: "f1" })],
    });
    res = await putFind(req("PUT", `/api/v1/hunts/${HUNT_ID}/finds/f1`, { sort_order: 3 }), findParams);
    expect(res.status).toBe(200);
    expect((await res.json()).review_status).toBeUndefined();
    expect(made.hunts).toHaveLength(2);
    expect(made.hunts[1].update).not.toHaveBeenCalled();
  });

  it("filters a stop's clue on edit", async () => {
    install({ hunts: [ok(approved)] });
    const res = await putFind(req("PUT", `/api/v1/hunts/${HUNT_ID}/finds/f1`, { clue_text: "f u c k" }), findParams);
    expect(res.status).toBe(400);
  });

  it("requeues when a stop is added to a listed hunt", async () => {
    const made = install({
      hunts: [ok(approved), ok([{ id: HUNT_ID }]), ok({ review_status: "pending" })],
      finds: [ok([]), ok({ id: "new" })],
    });
    const res = await addFind(req("POST", `/api/v1/hunts/${HUNT_ID}/finds`, { clue_text: "Find the fountain" }), huntParams);
    expect(res.status).toBe(201);
    expect((await res.json()).review_status).toBe("pending");
    expect(made.hunts[1].update.mock.calls[0][0]).toMatchObject({ review_status: "pending", is_public: false });
  });
});

describe("GET /hunts/{id}/rate", () => {
  const rows = [{ rating: 4, review_text: "Loved it", created_at: "2026-10-01" }];

  it("leaves review text out for anonymous visitors", async () => {
    h.user = null;
    install({ hunt_ratings: [ok(rows)] });
    const body = await (await getRatings(req("GET", `/api/v1/hunts/${HUNT_ID}/rate`), huntParams)).json();
    expect(body.avg_rating).toBe(4);
    expect(body.ratings).toEqual([{ rating: 4, created_at: "2026-10-01" }]);
  });

  it("includes review text for signed-in users", async () => {
    install({ hunt_ratings: [ok(rows)] });
    const body = await (await getRatings(req("GET", `/api/v1/hunts/${HUNT_ID}/rate`), huntParams)).json();
    expect(body.ratings[0].review_text).toBe("Loved it");
  });
});
