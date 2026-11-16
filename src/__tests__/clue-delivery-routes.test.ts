import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Route-level tests for clue delivery (lib/play/clue-delivery.ts): the play
 * routes enforce each player's order server-side, the start route records the
 * assigned order group, and the hunt routes lock the setting once it begins.
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
  generalLimiter: { check: async () => {} },
}));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST as primeViewed } from "@/app/api/v1/play/[huntId]/prime-viewed/route";
import { POST as clueHint } from "@/app/api/v1/play/[huntId]/clue-hint/route";
import { POST as startHunt } from "@/app/api/v1/play/[huntId]/start/route";
import { PUT as updateHunt } from "@/app/api/v1/hunts/[id]/route";
import { POST as addFind } from "@/app/api/v1/hunts/[id]/finds/route";
import { DELETE as deleteFind } from "@/app/api/v1/hunts/[id]/finds/[findId]/route";
import { assignOrderIndex } from "@/lib/play/clue-delivery";

const HUNT = "hunt-1";
const SESSION = "sess-1";
const STOPS = ["f0", "f1", "f2"];

function seed(huntMetadata: Row, opts: { status?: string; sessions?: Row[]; completions?: Row[] } = {}): SupabaseDouble {
  return installDouble({
    hunts: [
      {
        id: HUNT,
        title: "Hunt",
        status: opts.status ?? "published",
        review_status: "approved",
        identity_mode: "real_name",
        play_mode: "solo",
        created_by: "creator",
        deleted_at: null,
        metadata: huntMetadata,
      },
    ],
    play_sessions: opts.sessions ?? [
      { id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: new Date().toISOString(), metadata: {} },
    ],
    finds: STOPS.map((id, i) => ({ id, hunt_id: HUNT, sort_order: i, deleted_at: null, clue_hints: ["warmer"] })),
    find_completions: opts.completions ?? [],
  });
}

const done = (findId: string): Row => ({
  id: `c-${findId}`,
  play_session_id: SESSION,
  find_id: findId,
  arrived_at: "2026-01-01T00:00:00.000Z",
  completed_at: "2026-01-01T00:01:00.000Z",
  metadata: {},
  created_at: "2026-01-01T00:00:00.000Z",
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
const prime = (findId: string) => primeViewed(req("POST", "/prime-viewed", { find_id: findId }), playParams);

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
});

describe("play routes enforce the clue order", () => {
  it("fixed_order: only the first unfinished stop opens", async () => {
    seed({ clue_delivery: "fixed_order" });
    const ahead = await prime("f1");
    expect(ahead.status).toBe(409);
    expect((await ahead.json()).error).toMatch(/isn't open yet/);
    expect((await prime("f0")).status).toBe(201);
  });

  it("fixed_order: the next stop opens once the current one is finished", async () => {
    seed({ clue_delivery: "fixed_order" }, { completions: [done("f0")] });
    expect((await prime("f1")).status).toBe(201);
    expect((await prime("f2")).status).toBe(409);
  });

  it("all_at_once: any unfinished stop opens", async () => {
    seed({ clue_delivery: "all_at_once" });
    expect((await prime("f2")).status).toBe(201);
    expect((await prime("f1")).status).toBe(201);
  });

  it("rejects a stop from another hunt in every mode", async () => {
    seed({ clue_delivery: "all_at_once" });
    expect((await prime("elsewhere")).status).toBe(404);
  });

  it("assigned_order: follows the group recorded on the session", async () => {
    const orders = [STOPS, ["f2", "f0", "f1"]];
    seed(
      { clue_delivery: "assigned_order", clue_orders: orders },
      { sessions: [{ id: SESSION, hunt_id: HUNT, user_id: "u1", status: "active", started_at: new Date().toISOString(), metadata: { clue_order_index: 1 } }] }
    );
    expect((await prime("f0")).status).toBe(409);
    expect((await prime("f2")).status).toBe(201);
  });

  it("guards the clue hint route too", async () => {
    seed({ clue_delivery: "fixed_order" });
    const res = await clueHint(req("POST", "/clue-hint", { find_id: "f2", level: 1 }), playParams);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/isn't open yet/);
    const current = await clueHint(req("POST", "/clue-hint", { find_id: "f0", level: 1 }), playParams);
    expect(current.status).toBe(200);
  });
});

describe("start route records clue delivery on the session", () => {
  it("stores the mode and the player's deterministic order group", async () => {
    const db = seed({ clue_delivery: "assigned_order", clue_orders: [STOPS, ["f2", "f1", "f0"], ["f1", "f0", "f2"]] }, { sessions: [] });
    const res = await startHunt(req("POST", "/start", {}), playParams);
    expect(res.status).toBe(201);
    const body = await res.json();
    const expected = assignOrderIndex("u1", HUNT, 3);
    expect(body.clue_delivery).toBe("assigned_order");
    expect(body.clue_order_index).toBe(expected);
    expect(db.table("play_sessions")[0].metadata).toEqual({ clue_delivery: "assigned_order", clue_order_index: expected });
  });

  it("records only the mode for other modes", async () => {
    const db = seed({ shuffle_stops: true }, { sessions: [] });
    const body = await (await startHunt(req("POST", "/start", {}), playParams)).json();
    expect(body.clue_order_index).toBeNull();
    expect(db.table("play_sessions")[0].metadata).toEqual({ clue_delivery: "random_order" });
  });
});

describe("hunt routes lock clue delivery once the hunt begins", () => {
  beforeEach(() => {
    h.user = { id: "creator", role: "teacher" };
  });

  it("rejects changing the mode on a published hunt", async () => {
    seed({ clue_delivery: "fixed_order" });
    const res = await updateHunt(req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery: "all_at_once" } }), huntParams);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/locked/i);
  });

  it("rejects changing it on a draft someone has already played", async () => {
    seed({ clue_delivery: "fixed_order" }, { status: "draft" });
    const res = await updateHunt(req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery: "random_order" } }), huntParams);
    expect(res.status).toBe(409);
  });

  it("still allows unrelated settings on a locked hunt", async () => {
    seed({ clue_delivery: "fixed_order" }, { status: "draft" });
    const res = await updateHunt(
      req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery: "fixed_order", hide_scores: true } }),
      huntParams
    );
    expect(res.status).toBe(200);
  });

  it("allows a valid change on an unplayed draft, and rejects incomplete orders", async () => {
    seed({}, { status: "draft", sessions: [] });
    const bad = await updateHunt(
      req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery: "assigned_order", clue_orders: [STOPS, ["f0"]] } }),
      huntParams
    );
    expect(bad.status).toBe(400);
    const good = await updateHunt(
      req("PUT", `/hunts/${HUNT}`, { metadata: { clue_delivery: "assigned_order", clue_orders: [STOPS, ["f2", "f1", "f0"]] } }),
      huntParams
    );
    expect(good.status).toBe(200);
  });

  it("blocks adding or removing stops on a locked assigned_order hunt", async () => {
    seed({ clue_delivery: "assigned_order", clue_orders: [STOPS, ["f2", "f1", "f0"]] }, { status: "draft" });
    const added = await addFind(req("POST", `/hunts/${HUNT}/finds`, { clue_text: "New" }), huntParams);
    expect(added.status).toBe(409);
    expect((await added.json()).error).toMatch(/assigned orders/);
    const removed = await deleteFind(req("DELETE", `/hunts/${HUNT}/finds/f1`), {
      params: Promise.resolve({ id: HUNT, findId: "f1" }),
    });
    expect(removed.status).toBe(409);
  });
});
