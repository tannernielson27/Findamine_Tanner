import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Assigned clue orders are for the hunt's owner and reviewers only: players
 * reading a hunt get the mode, never the orders (they get their own order
 * from /play/start). The orders come from hunt_clue_orders (migration 083).
 */

type Result = { data: unknown; error: unknown; count?: number };

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  results: {} as Record<string, Result>,
  tables: [] as string[],
}));

function query(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = () => q;
  q.single = async () => result;
  q.maybeSingle = async () => result;
  q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return q;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({
    from: (table: string) => {
      h.tables.push(table);
      return query(h.results[table] ?? { data: null, error: null });
    },
  }),
}));
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));

vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/rate-limit", () => ({ generalLimiter: { check: async () => {} } }));

import { GET as getHunt } from "@/app/api/v1/hunts/[id]/route";
import { GET as listHunts } from "@/app/api/v1/hunts/route";

const ORDERS = [["f0", "f1"], ["f1", "f0"]];
const huntRow = (metadata: Record<string, unknown>) => ({
  id: "h1",
  title: "Hunt",
  status: "published",
  review_status: "approved",
  is_public: true,
  created_by: "creator",
  deleted_at: null,
  metadata,
  finds: [],
});

const params = { params: Promise.resolve({ id: "h1" }) };
const get = () => getHunt(new NextRequest("http://localhost:3000/api/v1/hunts/h1"), params);

beforeEach(() => {
  h.tables = [];
  h.results = {
    hunts: { data: huntRow({ clue_delivery: "assigned_order" }), error: null },
    play_sessions: { data: null, error: null, count: 2 },
    hunt_clue_orders: { data: { orders: ORDERS }, error: null },
  };
});

describe("GET /hunts/{id} and assigned clue orders", () => {
  it("never sends a player the orders, not even legacy ones left in metadata", async () => {
    h.user = { id: "player", role: "adult" };
    h.results.hunts = { data: huntRow({ clue_delivery: "assigned_order", clue_orders: ORDERS }), error: null };
    const body = await (await get()).json();
    expect(body.hunt.metadata).toEqual({ clue_delivery: "assigned_order" });
    expect(h.tables).not.toContain("hunt_clue_orders");
  });

  it("gives the owner the orders from their table, plus the lock state", async () => {
    h.user = { id: "creator", role: "teacher" };
    const body = await (await get()).json();
    expect(body.hunt.metadata.clue_orders).toEqual(ORDERS);
    expect(body.hunt.delivery_locked).toBe(true);
    expect(body.hunt.has_play_sessions).toBe(true);
    // Assigned orders freeze stops once locked, study hunt or not.
    expect(body.hunt.stops_frozen).toBe(true);
    expect(body.hunt.viewer_can_set_study_hunt).toBe(false);
  });

  it("gives reviewers the orders too, and the study-hunt toggle", async () => {
    h.user = { id: "rev", role: "researcher" };
    const body = await (await get()).json();
    expect(body.hunt.metadata.clue_orders).toEqual(ORDERS);
    expect(body.hunt.viewer_can_set_study_hunt).toBe(true);
  });

  it("reports stops as frozen only for a locked study hunt (or assigned orders)", async () => {
    h.user = { id: "creator", role: "teacher" };
    h.results.hunts = { data: huntRow({ clue_delivery: "fixed_order" }), error: null };
    expect((await (await get()).json()).hunt.stops_frozen).toBe(false);
    h.results.hunts = { data: huntRow({ clue_delivery: "fixed_order", study_hunt: true }), error: null };
    expect((await (await get()).json()).hunt.stops_frozen).toBe(true);
  });

  it("does not query the orders table for other modes", async () => {
    h.user = { id: "creator", role: "teacher" };
    h.results.hunts = { data: huntRow({ clue_delivery: "random_order" }), error: null };
    await get();
    expect(h.tables).not.toContain("hunt_clue_orders");
  });
});

describe("player never receives clue_orders", () => {
  const playerRoles = ["adult", "child", "teen", "teacher", "hunt_creator"];

  it.each(playerRoles)("GET /hunts/{id} as a %s who does not own the hunt", async (role) => {
    h.user = { id: "someone-else", role };
    // Worst case: orders in the table AND stray legacy orders in metadata.
    h.results.hunts = { data: huntRow({ clue_delivery: "assigned_order", clue_orders: ORDERS }), error: null };
    const res = await get();
    const text = await res.text();
    expect(text).not.toContain("clue_orders");
    expect(text).not.toContain('["f1","f0"]');
    expect(h.tables).not.toContain("hunt_clue_orders");
  });

  it("GET /hunts/{id} signed out", async () => {
    h.user = null;
    h.results.hunts = { data: huntRow({ clue_delivery: "assigned_order", clue_orders: ORDERS }), error: null };
    expect(await (await get()).text()).not.toContain("clue_orders");
  });

  it("GET /hunts catalogue", async () => {
    h.user = null;
    h.results.hunts = { data: [huntRow({ clue_delivery: "assigned_order", clue_orders: ORDERS })], error: null };
    const text = await (await listHunts(new NextRequest("http://localhost:3000/api/v1/hunts"))).text();
    expect(text).not.toContain("clue_orders");
  });

  it("even the owner is never served stray orders from metadata: only the table counts", async () => {
    h.user = { id: "creator", role: "teacher" };
    h.results.hunts = { data: huntRow({ clue_delivery: "assigned_order", clue_orders: ORDERS }), error: null };
    h.results.hunt_clue_orders = { data: null, error: null };
    const body = await (await get()).json();
    expect(body.hunt.metadata.clue_orders).toEqual([]);
  });
});

describe("GET /hunts (catalogue)", () => {
  it("strips legacy orders from catalogue rows", async () => {
    h.results.hunts = { data: [huntRow({ clue_delivery: "assigned_order", clue_orders: ORDERS })], error: null };
    const body = await (await listHunts(new NextRequest("http://localhost:3000/api/v1/hunts"))).json();
    expect(body.hunts[0].metadata).toEqual({ clue_delivery: "assigned_order" });
  });
});
