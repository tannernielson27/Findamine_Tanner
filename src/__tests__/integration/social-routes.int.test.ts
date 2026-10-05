import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
}));

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
vi.mock("@/lib/utils/rate-limit", () => {
  const open = { check: async () => {} };
  return { socialLimiter: open, generalLimiter: open };
});

import { GET as listFriends, POST as requestFriend } from "@/app/api/v1/social/friends/route";
import { PUT as answerFriend, DELETE as removeFriend } from "@/app/api/v1/social/friends/[id]/route";
import { GET as listKudos, POST as sendKudos } from "@/app/api/v1/social/kudos/route";
import { GET as gamificationMe } from "@/app/api/v1/gamification/me/route";
import { GET as leaderboard } from "@/app/api/v1/leaderboard/route";

const ME = "00000000-0000-4000-8000-000000000001";
const ADA = "00000000-0000-4000-8000-000000000002";
const KID = "00000000-0000-4000-8000-000000000003";
const BO = "00000000-0000-4000-8000-000000000004";

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const USERS = [
  { id: ME, role: "adult", display_name: "Me", deleted_at: null, profile_visibility: {} },
  { id: ADA, role: "adult", display_name: "Ada", deleted_at: null, profile_visibility: {} },
  { id: KID, role: "child", display_name: "Kid", deleted_at: null, profile_visibility: {} },
  { id: BO, role: "adult", display_name: "Bo", deleted_at: null, profile_visibility: { display_name: "nobody" } },
];

describe("friend routes", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    h.user = { id: ME, role: "adult" };
    db = installDouble(
      { users: USERS.map((u) => ({ ...u })), friend_connections: [] },
      { unique: { friend_connections: [["requester_id", "addressee_id"]] } }
    );
  });

  const connections = () => db.table("friend_connections");

  it("creates a pending request and refuses self, strangers, children and repeats", async () => {
    expect((await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: ME }))).status).toBe(400);
    expect((await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: "not-a-uuid" }))).status).toBe(400);
    expect(
      (await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: "00000000-0000-4000-8000-00000000ffff" }))).status
    ).toBe(404);
    expect((await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: KID }))).status).toBe(403);
    expect(connections()).toHaveLength(0);

    const ok = await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: ADA }));
    expect(ok.status).toBe(201);
    expect(connections()).toHaveLength(1);
    expect(connections()[0]).toMatchObject({ requester_id: ME, addressee_id: ADA });

    const again = await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: ADA }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/already exists/i);
    expect(connections()).toHaveLength(1);
  });

  it("blocks child accounts from sending requests", async () => {
    h.user = { id: KID, role: "child" };
    const res = await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: ADA }));
    expect(res.status).toBe(403);
    expect(connections()).toHaveLength(0);
  });

  it("lists accepted friends by default and pending ones with ?status=all, each with a direction", async () => {
    connections().push(
      { id: "c-acc", requester_id: ME, addressee_id: ADA, status: "accepted", created_at: "2026-01-03" },
      { id: "c-in", requester_id: BO, addressee_id: ME, status: "pending", created_at: "2026-01-02" },
      { id: "c-dec", requester_id: ME, addressee_id: KID, status: "declined", created_at: "2026-01-01" }
    );

    const byDefault = (await (await listFriends(req("GET", "/api/v1/social/friends"))).json()).friends;
    expect(byDefault.map((f: { id: string }) => f.id)).toEqual(["c-acc"]);

    const all = (await (await listFriends(req("GET", "/api/v1/social/friends?status=all"))).json()).friends;
    expect(all.map((f: { id: string; direction: string }) => [f.id, f.direction])).toEqual([
      ["c-acc", "outgoing"],
      ["c-in", "incoming"],
    ]);
    // Both contracts are present on every row.
    for (const f of all) {
      expect(f).toHaveProperty("friend");
      expect(f).toHaveProperty("requester");
      expect(f).toHaveProperty("addressee");
    }
  });

  it("lets only the person who was asked answer, and only while pending", async () => {
    connections().push({ id: "c1", requester_id: ME, addressee_id: ADA, status: "pending" });

    // The requester can't accept their own request.
    expect((await answerFriend(req("PUT", "/x", { status: "accepted" }), idParams("c1"))).status).toBe(404);
    expect(connections()[0].status).toBe("pending");
    expect((await answerFriend(req("PUT", "/x", { status: "friends" }), idParams("c1"))).status).toBe(400);

    h.user = { id: ADA, role: "adult" };
    expect((await answerFriend(req("PUT", "/x", { status: "accepted" }), idParams("c1"))).status).toBe(200);
    expect(connections()[0].status).toBe("accepted");
    // Already answered: a second answer finds nothing waiting.
    expect((await answerFriend(req("PUT", "/x", { status: "declined" }), idParams("c1"))).status).toBe(404);
    expect(connections()[0].status).toBe("accepted");
  });

  it("lets either side remove a friendship, but not a requester clear a decline", async () => {
    connections().push(
      { id: "c1", requester_id: ME, addressee_id: ADA, status: "accepted" },
      { id: "c2", requester_id: ME, addressee_id: BO, status: "declined" },
      { id: "c3", requester_id: ADA, addressee_id: BO, status: "accepted" }
    );

    expect((await removeFriend(req("DELETE", "/x"), idParams("c2"))).status).toBe(404);
    expect((await removeFriend(req("DELETE", "/x"), idParams("c3"))).status).toBe(404);
    expect((await removeFriend(req("DELETE", "/x"), idParams("c1"))).status).toBe(200);
    expect(connections().map((c) => c.id)).toEqual(["c2", "c3"]);
  });
});

describe("kudos routes", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    h.user = { id: ME, role: "adult" };
    db = installDouble({
      users: USERS.map((u) => ({ ...u })),
      kudos: [
        { id: "k-in", sender_id: ADA, receiver_id: ME, message: "nice", created_at: "2026-01-01" },
        { id: "k-other", sender_id: ADA, receiver_id: BO, message: "hi", created_at: "2026-01-02" },
      ],
    });
  });

  it("rejects messages the kudos table can't hold instead of failing the insert", async () => {
    const res = await sendKudos(req("POST", "/api/v1/social/kudos", { receiver_id: ADA, message: "x".repeat(201) }));
    expect(res.status).toBe(400);
    expect(db.table("kudos")).toHaveLength(2);
  });

  it("returns a sent kudos with sender/receiver embeds and lists it under type=all", async () => {
    const res = await sendKudos(req("POST", "/api/v1/social/kudos", { receiver_id: ADA, message: "Great find!" }));
    expect(res.status).toBe(201);
    const { kudos } = await res.json();
    expect(kudos).toMatchObject({ sender_id: ME, receiver_id: ADA, message: "Great find!" });
    expect(kudos).toHaveProperty("sender");
    expect(kudos).toHaveProperty("receiver");

    const received = (await (await listKudos(req("GET", "/api/v1/social/kudos"))).json()).kudos;
    expect(received.map((k: { id: string }) => k.id)).toEqual(["k-in"]);

    const all = (await (await listKudos(req("GET", "/api/v1/social/kudos?type=all"))).json()).kudos;
    expect(all.map((k: { message: string }) => k.message).sort()).toEqual(["Great find!", "nice"]);
  });

  it("tells child accounts why kudos can't be sent", async () => {
    h.user = { id: KID, role: "child" };
    const res = await sendKudos(req("POST", "/api/v1/social/kudos", { receiver_id: ADA, message: "hi" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/child accounts/i);
  });
});

describe("GET /api/v1/gamification/me", () => {
  it("returns the fields the profile page reads", async () => {
    h.user = { id: ME, role: "adult" };
    installDouble(
      {
        streaks: [{ user_id: ME, current_streak: 4, longest_streak: 9 }],
        points_ledger: [
          { user_id: ME, amount: 120 },
          { user_id: ME, amount: 50 },
          { user_id: ME, amount: null },
          { user_id: ADA, amount: 999 },
        ],
        play_sessions: [
          { id: "s1", user_id: ME, status: "completed", total_score: 100 },
          { id: "s2", user_id: ME, status: "completed", total_score: 20 },
          { id: "s3", user_id: ME, status: "active", total_score: 50 },
          { id: "s4", user_id: ADA, status: "completed", total_score: 999 },
        ],
        user_badges: [{ user_id: ME, badge_type_id: "b1" }],
        badge_types: [{ id: "b1", code: "first_find", name: "First Find" }],
      },
      { embeds: { user_badges: { badge_types: { table: "badge_types", localKey: "badge_type_id" } } } }
    );

    const body = await (await gamificationMe(req("GET", "/api/v1/gamification/me"))).json();
    expect(body.total_points).toBe(170);
    expect(body.hunts_completed).toBe(2);
    expect(body.streak.current_streak).toBe(4);
    expect(body.badges_earned).toBe(1);
  });
});

describe("GET /api/v1/leaderboard (overall)", () => {
  // What overall_leaderboard() returns: finished-hunt score per player, best first.
  const RANKED = [
    { user_id: ADA, total_score: 500, hunts_completed: 3, display_name: "Ada", avatar_url: null, role: "adult", best_codename: null },
    { user_id: BO, total_score: 400, hunts_completed: 2, display_name: "Bo", avatar_url: null, role: "adult", best_codename: null },
    { user_id: KID, total_score: 300, hunts_completed: 2, display_name: "Kid", avatar_url: null, role: "child", best_codename: "Swift Otter" },
    { user_id: ME, total_score: 120, hunts_completed: 1, display_name: "Me", avatar_url: null, role: "adult", best_codename: null },
  ];

  function install(ranked = RANKED) {
    return installDouble(
      { users: USERS.map((u) => ({ ...u })) },
      { rpc: { overall_leaderboard: (args) => ranked.slice(0, args.p_limit as number) } }
    );
  }

  it("reports the caller's own standing when they are below the visible rows", async () => {
    h.user = { id: ME, role: "adult" };
    install();
    const body = await (await leaderboard(req("GET", "/api/v1/leaderboard?limit=2"))).json();
    expect(body.entries.map((e: { user_id: string }) => e.user_id)).toEqual([ADA, BO]);
    expect(body.me).toEqual({ rank: 4, score: 120, gap_to_next: 180 });
  });

  it("reports no standing for a caller who hasn't finished a hunt, and none when signed out", async () => {
    h.user = { id: ME, role: "adult" };
    install(RANKED.filter((r) => r.user_id !== ME));
    expect((await (await leaderboard(req("GET", "/api/v1/leaderboard"))).json()).me).toBeNull();

    h.user = null;
    install();
    const anon = await (await leaderboard(req("GET", "/api/v1/leaderboard?limit=2"))).json();
    expect(anon.me).toBeNull();
    expect(anon.entries).toHaveLength(2);
  });

  it("never shows a restricted display name, and only links rows that show a real one", async () => {
    h.user = { id: ME, role: "adult" };
    install();
    const { entries } = await (await leaderboard(req("GET", "/api/v1/leaderboard"))).json();
    const byId = Object.fromEntries(entries.map((e: { user_id: string }) => [e.user_id, e]));

    expect(byId[ADA]).toMatchObject({ display_name: "Ada", profile_linkable: true });
    // Bo set display_name to "nobody" and has no codename to stand in.
    expect(byId[BO]).toMatchObject({ display_name: "Anonymous", profile_linkable: false });
    // A codename row must not lead to the profile behind it.
    expect(byId[KID]).toMatchObject({ display_name: "Swift Otter", profile_linkable: false });
    expect(byId[ME]).toMatchObject({ display_name: "Me", score: 120 });
    for (const e of entries) expect(e).not.toHaveProperty("named");
  });
});
