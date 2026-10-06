import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Hint ratings, technique reviews and the draft-hunt start guard: a failed
 * write must reach the player as an error, never as a silent 200.
 */

type Result = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  results: {} as Record<string, { data: unknown; error: unknown }>,
  inserts: [] as { table: string; row: unknown }[],
  user: null as null | { id: string; role: string },
}));

function query(table: string) {
  const result: Result = h.results[table] ?? { data: null, error: null };
  const q: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "in", "is", "neq", "limit"]) q[m] = () => q;
  q.insert = (row: unknown) => {
    h.inserts.push({ table, row });
    return q;
  };
  q.single = async () => result;
  q.maybeSingle = async () => result;
  q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({ from: (table: string) => query(table) }),
}));
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/track-event", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { POST as rateHint } from "@/app/api/v1/hints/rate/route";
import { POST as reviewTechnique } from "@/app/api/v1/technique-review/route";
import { POST as startHunt } from "@/app/api/v1/play/[huntId]/start/route";

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  h.results = {};
  h.inserts = [];
  h.user = { id: "u1", role: "teen" };
});

describe("POST /hints/rate", () => {
  it("saves a rating", async () => {
    const res = await rateHint(post("/api/v1/hints/rate", { find_id: "f1", rating: 1 }));
    expect(res.status).toBe(200);
    expect(h.inserts[0]).toMatchObject({ table: "hint_ratings", row: { user_id: "u1", find_id: "f1", rating: 1 } });
  });

  it("returns 500 when the insert fails, without leaking the database message", async () => {
    h.results.hint_ratings = { data: null, error: { code: "XX000", message: "relation secret_table broke" } };
    const res = await rateHint(post("/api/v1/hints/rate", { find_id: "f1", rating: -1 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Could not save your rating. Please try again.");
  });

  it("returns 400 when the hint or stop does not exist", async () => {
    h.results.hint_ratings = { data: null, error: { code: "23503", message: "fk" } };
    expect((await rateHint(post("/api/v1/hints/rate", { find_id: "gone", rating: 1 }))).status).toBe(400);
  });

  it("still validates the rating", async () => {
    expect((await rateHint(post("/api/v1/hints/rate", { rating: 5 }))).status).toBe(400);
    expect(h.inserts).toHaveLength(0);
  });
});

describe("POST /technique-review", () => {
  it("saves a review", async () => {
    const res = await reviewTechnique(
      post("/api/v1/technique-review", { hunt_id: "h1", strategies: ["guessed", "made_up"], confidence: 9 })
    );
    expect(res.status).toBe(200);
    expect(h.inserts[0].row).toMatchObject({ strategies: ["guessed"], confidence: 3 });
  });

  it("returns 500 when the insert fails", async () => {
    h.results.technique_reviews = { data: null, error: { code: "XX000", message: "boom" } };
    const res = await reviewTechnique(post("/api/v1/technique-review", { hunt_id: "h1", strategies: [] }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Could not save your reflection. Please try again.");
  });

  it("returns 400 for an id that is not a UUID", async () => {
    h.results.technique_reviews = { data: null, error: { code: "22P02", message: "invalid uuid" } };
    expect((await reviewTechnique(post("/api/v1/technique-review", { hunt_id: "nope" }))).status).toBe(400);
  });
});

describe("POST /play/[huntId]/start on an unpublished hunt", () => {
  const params = { params: Promise.resolve({ huntId: "h1" }) };
  const draft = { id: "h1", status: "draft", identity_mode: "real_name", created_by: "owner-1" };

  it("tells the owner the hunt must be published, and starts no session", async () => {
    h.user = { id: "owner-1", role: "teacher" };
    h.results.hunts = { data: draft, error: null };
    const res = await startHunt(post("/api/v1/play/h1/start", {}), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't published yet/);
    expect(h.inserts).toHaveLength(0);
  });

  it("does the same for an admin", async () => {
    h.user = { id: "admin-1", role: "admin" };
    h.results.hunts = { data: draft, error: null };
    expect((await startHunt(post("/api/v1/play/h1/start", {}), params)).status).toBe(409);
    expect(h.inserts).toHaveLength(0);
  });

  it("does not reveal a draft to anyone else", async () => {
    h.results.hunts = { data: draft, error: null };
    const res = await startHunt(post("/api/v1/play/h1/start", {}), params);
    expect(res.status).toBe(404);
    expect(h.inserts).toHaveLength(0);
  });
});
