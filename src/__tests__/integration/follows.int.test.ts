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

import { GET as listFollows, POST as follow } from "@/app/api/v1/social/follows/route";
import { DELETE as unfollow } from "@/app/api/v1/social/follows/[userId]/route";
import { GET as viewProfile } from "@/app/api/v1/users/[id]/profile/route";
import { PUT as setAudience } from "@/app/api/v1/social/referrals/audience/route";
import { notifyCrewJoined } from "@/lib/social/crew-audience";
import { getViewerRelationship, getViewerRelationships, resolveViewerRelationship } from "@/lib/utils/viewer";
import { blockUser } from "@/lib/moderation/blocks";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const ME = "00000000-0000-4000-8000-000000000001";
const ADA = "00000000-0000-4000-8000-000000000002";
const KID = "00000000-0000-4000-8000-000000000003";
const BO = "00000000-0000-4000-8000-000000000004";
const TEEN = "00000000-0000-4000-8000-000000000005";
const GHOST = "00000000-0000-4000-8000-00000000ffff";

function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const userParams = (userId: string) => ({ params: Promise.resolve({ userId }) });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const USERS = [
  { id: ME, role: "adult", display_name: "Me", avatar_url: null, deleted_at: null, metadata: {}, profile_visibility: {} },
  // Ada shares her name with everyone, her score with crew + people she follows, her badges with crew only.
  {
    id: ADA, role: "adult", display_name: "Ada", avatar_url: null, deleted_at: null, metadata: {},
    profile_visibility: { total_score: "class", badges: "team", hunt_history: "nobody" },
  },
  { id: KID, role: "child", display_name: "Kid", avatar_url: null, deleted_at: null, metadata: {}, profile_visibility: {} },
  { id: BO, role: "adult", display_name: "Bo", avatar_url: null, deleted_at: null, metadata: {}, profile_visibility: { display_name: "nobody" } },
  { id: TEEN, role: "teen", display_name: "Teen", avatar_url: null, deleted_at: null, metadata: {}, profile_visibility: { total_score: "class" } },
];

function seed(extra: Record<string, Record<string, unknown>[]> = {}): SupabaseDouble {
  return installDouble(
    {
      users: USERS.map((u) => ({ ...u })),
      player_follows: [],
      minion_links: [],
      user_blocks: [],
      friend_connections: [],
      team_members: [],
      roster_entries: [],
      notifications: [],
      behavioral_events: [],
      points_ledger: [],
      user_badges: [],
      play_sessions: [],
      player_assessments: [],
      ...extra,
    },
    {
      unique: { player_follows: [["follower_id", "followee_id"]], user_blocks: [["blocker_id", "blocked_id"]] },
      embeds: { user_badges: { badge_types: { table: "badge_types", localKey: "badge_type_id" } } },
    }
  );
}

describe("follow routes", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    h.user = { id: ME, role: "adult" };
    db = seed();
  });
  const follows = () => db.table("player_follows");
  const post = (userId: unknown) => follow(req("POST", "/api/v1/social/follows", { user_id: userId }));

  it("follows without approval, tells the followed player once, and is idempotent", async () => {
    const first = await post(ADA);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ following: true, created: true });
    expect(follows()).toHaveLength(1);
    expect(follows()[0]).toMatchObject({ follower_id: ME, followee_id: ADA });

    const notices = db.table("notifications");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ user_id: ADA, type: "new_follower", entity_type: "user", entity_id: ME });
    expect(notices[0].title).toBe("Me started following you");
    expect(db.table("behavioral_events").map((e) => e.event_type)).toEqual(["follow_added"]);

    const again = await post(ADA);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ following: true, created: false });
    expect(follows()).toHaveLength(1);
    expect(notices).toHaveLength(1);
  });

  it("notifies once per follower, however often they unfollow and follow again", async () => {
    for (let round = 0; round < 3; round++) {
      expect((await post(ADA)).status).toBe(201);
      await unfollow(req("DELETE", `/api/v1/social/follows/${ADA}`), userParams(ADA));
    }
    expect(follows()).toHaveLength(0);
    expect(db.table("notifications")).toHaveLength(1);

    // A different follower still gets through.
    h.user = { id: BO, role: "adult" };
    expect((await post(ADA)).status).toBe(201);
    expect(db.table("notifications")).toHaveLength(2);
  });

  it("leaves deleted accounts out of the lists and out of every audience", async () => {
    follows().push(
      { id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" },
      { id: "f2", follower_id: ADA, followee_id: ME, created_at: "2026-12-02" }
    );
    expect(await getViewerRelationship(ME, ADA)).toBe("class");

    const ada = db.table("users").find((u) => u.id === ADA);
    if (ada) ada.deleted_at = "2026-12-03T00:00:00Z";
    const lists = await (await listFollows(req("GET", "/api/v1/social/follows"))).json();
    expect(lists.following).toEqual([]);
    expect(lists.followers).toEqual([]);
    expect(await getViewerRelationship(ME, ADA)).toBe("public");
  });

  it("keeps a hidden name out of the notification", async () => {
    h.user = { id: BO, role: "adult" };
    expect((await post(ADA)).status).toBe(201);
    expect(db.table("notifications")[0].title).toBe("A player started following you");
  });

  it("refuses bad ids, self, missing players, minors and blocked pairs", async () => {
    expect((await post("not-a-uuid")).status).toBe(400);
    expect((await post(undefined)).status).toBe(400);
    expect((await post(ME)).status).toBe(400);
    expect((await post(GHOST)).status).toBe(404);
    expect((await post(KID)).status).toBe(403);
    expect((await post(TEEN)).status).toBe(403);

    db.table("user_blocks").push({ blocker_id: ADA, blocked_id: ME });
    expect((await post(ADA)).status).toBe(403);
    expect(follows()).toHaveLength(0);
    expect(db.table("notifications")).toHaveLength(0);
  });

  it("is closed to child and teen accounts, and says so on read", async () => {
    for (const minor of [{ id: KID, role: "child" }, { id: TEEN, role: "teen" }]) {
      h.user = minor;
      expect((await post(ADA)).status).toBe(403);
      const lists = await (await listFollows(req("GET", "/api/v1/social/follows"))).json();
      expect(lists).toEqual({ available: false, following: [], followers: [] });
      const one = await (await listFollows(req("GET", `/api/v1/social/follows?user_id=${ADA}`))).json();
      expect(one).toEqual({ available: false, following: false, follows_you: false });
    }
    expect(follows()).toHaveLength(0);
  });

  it("refuses a request from another site", async () => {
    const res = await follow(req("POST", "/api/v1/social/follows", { user_id: ADA }, { origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(follows()).toHaveLength(0);
  });

  it("requires sign-in on every method", async () => {
    h.user = null;
    expect((await listFollows(req("GET", "/api/v1/social/follows"))).status).toBe(401);
    expect((await post(ADA)).status).toBe(401);
    expect((await unfollow(req("DELETE", `/api/v1/social/follows/${ADA}`), userParams(ADA))).status).toBe(401);
  });

  it("lists both directions with names filtered by each person's own settings", async () => {
    follows().push(
      { id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" },
      { id: "f2", follower_id: ADA, followee_id: ME, created_at: "2026-12-02" },
      { id: "f3", follower_id: BO, followee_id: ME, created_at: "2026-12-03" },
      { id: "f4", follower_id: ADA, followee_id: BO, created_at: "2026-12-04" }
    );

    const lists = await (await listFollows(req("GET", "/api/v1/social/follows"))).json();
    expect(lists.available).toBe(true);
    expect(lists.following).toEqual([
      { user_id: ADA, created_at: "2026-12-01", display_name: "Ada", avatar_url: null },
    ]);
    // Newest first. Bo hides his name from everyone, so he is listed without it.
    expect(lists.followers).toEqual([
      { user_id: BO, created_at: "2026-12-03", display_name: null, avatar_url: null, you_follow: false },
      { user_id: ADA, created_at: "2026-12-02", display_name: "Ada", avatar_url: null, you_follow: true },
    ]);
    // Nothing about a follow the viewer is not part of.
    expect(JSON.stringify(lists)).not.toContain("f4");

    const one = await (await listFollows(req("GET", `/api/v1/social/follows?user_id=${BO}`))).json();
    expect(one).toEqual({ available: true, following: false, follows_you: true });
    expect((await listFollows(req("GET", "/api/v1/social/follows?user_id=nope"))).status).toBe(400);
  });

  it("leaves blocked players out of both lists", async () => {
    follows().push(
      { id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" },
      { id: "f2", follower_id: BO, followee_id: ME, created_at: "2026-12-02" }
    );
    db.table("user_blocks").push({ blocker_id: BO, blocked_id: ME }, { blocker_id: ME, blocked_id: ADA });
    const lists = await (await listFollows(req("GET", "/api/v1/social/follows"))).json();
    expect(lists.following).toEqual([]);
    expect(lists.followers).toEqual([]);
  });

  it("unfollows, removes a follower, and never touches someone else's follow", async () => {
    follows().push(
      { id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" },
      { id: "f2", follower_id: BO, followee_id: ME, created_at: "2026-12-02" },
      { id: "f3", follower_id: ADA, followee_id: BO, created_at: "2026-12-03" }
    );
    const del = (id: string, query = "") =>
      unfollow(req("DELETE", `/api/v1/social/follows/${id}${query}`), userParams(id));

    // Default direction: my follow of BO. There is none, and BO's follow of me stays.
    expect(await (await del(BO)).json()).toEqual({ removed: false });
    expect(follows()).toHaveLength(3);

    expect(await (await del(ADA)).json()).toEqual({ removed: true });
    expect(follows().map((f) => f.id)).toEqual(["f2", "f3"]);

    expect(await (await del(BO, "?direction=follower")).json()).toEqual({ removed: true });
    expect(follows().map((f) => f.id)).toEqual(["f3"]);

    expect((await del(ADA, "?direction=sideways")).status).toBe(400);
    expect((await del("not-a-uuid")).status).toBe(400);
    expect(follows().map((f) => f.id)).toEqual(["f3"]);

    const events = db.table("behavioral_events").filter((e) => e.event_type === "follow_removed");
    expect(events.map((e) => (e.payload as { removed_by: string }).removed_by)).toEqual(["follower", "followee"]);
  });

  it("lets a teen undo a follow that exists, even though they can't create one", async () => {
    follows().push({ id: "f1", follower_id: ADA, followee_id: TEEN, created_at: "2026-12-01" });
    h.user = { id: TEEN, role: "teen" };
    const res = await unfollow(req("DELETE", `/api/v1/social/follows/${ADA}?direction=follower`), userParams(ADA));
    expect(await res.json()).toEqual({ removed: true });
    expect(follows()).toHaveLength(0);
  });
});

describe("social audiences", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    h.user = { id: ME, role: "adult" };
    db = seed();
  });

  it("gives a follower nothing: only the owner following the viewer opens the 'class' audience", async () => {
    db.table("player_follows").push({ id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" });
    expect(await getViewerRelationship(ME, ADA)).toBe("public");

    db.table("player_follows").push({ id: "f2", follower_id: ADA, followee_id: ME, created_at: "2026-12-02" });
    expect(await resolveViewerRelationship(ME, ADA)).toEqual({ relationship: "class", via: "follow" });
  });

  it("lets a crew member into the recruiter's 'team' audience only once the recruiter approves them", async () => {
    db.table("minion_links").push({ id: "m1", recruiter_id: ADA, minion_id: ME, audience_approved_at: null });
    // Joining with Ada's code opens nothing of Ada's...
    expect(await resolveViewerRelationship(ME, ADA)).toEqual({ relationship: "public", via: "public" });
    expect((await getViewerRelationships(ME, [ADA])).get(ADA)).toBe("public");
    // ...but the member chose their recruiter, so Ada is in the member's audience at once.
    expect(await resolveViewerRelationship(ADA, ME)).toEqual({ relationship: "team", via: "crew" });

    db.table("minion_links")[0].audience_approved_at = "2026-12-02T00:00:00Z";
    expect(await resolveViewerRelationship(ME, ADA)).toEqual({ relationship: "team", via: "crew" });
    expect((await getViewerRelationships(ME, [ADA])).get(ADA)).toBe("team");
  });

  it("puts an approved crew tie ahead of a follow", async () => {
    db.table("player_follows").push({ id: "f1", follower_id: ADA, followee_id: ME, created_at: "2026-12-01" });
    db.table("minion_links").push({ id: "m1", recruiter_id: ADA, minion_id: ME, audience_approved_at: null });
    expect(await resolveViewerRelationship(ME, ADA)).toEqual({ relationship: "class", via: "follow" });
    db.table("minion_links")[0].audience_approved_at = "2026-12-02T00:00:00Z";
    expect(await resolveViewerRelationship(ME, ADA)).toEqual({ relationship: "team", via: "crew" });
  });

  it("never applies social ties to a child's or teen's profile", async () => {
    db.table("player_follows").push({ id: "f1", follower_id: TEEN, followee_id: ME, created_at: "2026-12-01" });
    db.table("minion_links").push(
      { id: "m1", recruiter_id: ME, minion_id: KID, audience_approved_at: null },
      { id: "m2", recruiter_id: TEEN, minion_id: ME, audience_approved_at: "2026-12-01T00:00:00Z" }
    );
    expect(await getViewerRelationship(ME, TEEN)).toBe("public");
    expect(await getViewerRelationship(ME, KID)).toBe("public");
    const bulk = await getViewerRelationships(ME, [TEEN, KID]);
    expect([bulk.get(TEEN), bulk.get(KID)]).toEqual(["public", "public"]);
  });

  it("keeps a real team or class when it is at least as close as the tie", async () => {
    db.table("team_members").push(
      { team_id: "t1", user_id: ME, status: "active" },
      { team_id: "t1", user_id: ADA, status: "active" }
    );
    db.table("player_follows").push({ id: "f1", follower_id: ADA, followee_id: ME, created_at: "2026-12-01" });
    expect(await resolveViewerRelationship(ME, ADA)).toEqual({ relationship: "team", via: "team" });

    db.table("roster_entries").push({ roster_id: "r1", student_id: ME }, { roster_id: "r1", student_id: BO });
    db.table("player_follows").push({ id: "f2", follower_id: BO, followee_id: ME, created_at: "2026-12-02" });
    expect(await resolveViewerRelationship(ME, BO)).toEqual({ relationship: "class", via: "class" });
  });

  it("resolves many targets the same way as one", async () => {
    db.table("player_follows").push(
      { id: "f1", follower_id: ADA, followee_id: ME, created_at: "2026-12-01" },
      { id: "f2", follower_id: ME, followee_id: BO, created_at: "2026-12-02" }
    );
    db.table("minion_links").push({ id: "m1", recruiter_id: ME, minion_id: BO });
    const bulk = await getViewerRelationships(ME, [ME, ADA, BO, TEEN, GHOST]);
    expect(Object.fromEntries(bulk)).toEqual({ [ME]: "self", [ADA]: "class", [BO]: "team", [TEEN]: "public", [GHOST]: "public" });
    for (const id of [ADA, BO, TEEN]) {
      expect(await getViewerRelationship(ME, id)).toBe(bulk.get(id));
    }
  });

  it("shows a profile exactly what the owner's audiences allow", async () => {
    db.table("points_ledger").push({ user_id: ADA, amount: 120 });
    db.table("user_badges").push({ user_id: ADA, earned_at: "2026-12-01", badge_types: null });
    const view = async () => (await viewProfile(req("GET", `/api/v1/users/${ADA}/profile`), idParams(ADA))).json();

    // A stranger who follows Ada: name only.
    db.table("player_follows").push({ id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" });
    let seen = await view();
    expect(seen.relationship_via).toBe("public");
    expect(seen.profile.display_name).toBe("Ada");
    expect(seen.profile.total_score).toBeNull();
    expect(seen.profile.badges).toBeNull();
    expect(seen.hidden_fields).toEqual(expect.arrayContaining(["total_score", "badges", "hunt_history"]));

    // Ada follows back: her "crew + following" audience now includes the viewer.
    db.table("player_follows").push({ id: "f2", follower_id: ADA, followee_id: ME, created_at: "2026-12-02" });
    seen = await view();
    expect(seen.relationship_via).toBe("follow");
    expect(seen.profile.total_score).toBe(120);
    expect(seen.profile.badges).toBeNull();

    // In Ada's crew and approved by her: the crew-only field opens too. "Only me" never does.
    db.table("minion_links").push({ id: "m1", recruiter_id: ADA, minion_id: ME, audience_approved_at: "2026-12-03T00:00:00Z" });
    seen = await view();
    expect(seen.relationship_via).toBe("crew");
    expect(seen.profile.badges).toHaveLength(1);
    expect(seen.profile.hunt_history).toBeNull();
  });

  it("removes follows in both directions when one player blocks the other", async () => {
    db.table("player_follows").push(
      { id: "f1", follower_id: ME, followee_id: ADA, created_at: "2026-12-01" },
      { id: "f2", follower_id: ADA, followee_id: ME, created_at: "2026-12-02" },
      { id: "f3", follower_id: BO, followee_id: ME, created_at: "2026-12-03" }
    );
    await blockUser(await createSupabaseServiceClient(), ME, ADA);
    expect(db.table("player_follows").map((f) => f.id)).toEqual(["f3"]);
    expect(await getViewerRelationship(ME, ADA)).toBe("public");
  });

  it("closes the crew audience too when either player blocks the other", async () => {
    // Bo joined Ada's crew and she approved him; the link itself is not removed by a block.
    db.table("minion_links").push({ id: "m1", recruiter_id: ADA, minion_id: BO, audience_approved_at: "2026-12-01T00:00:00Z" });
    expect(await getViewerRelationship(BO, ADA)).toBe("team");
    expect(await getViewerRelationship(ADA, BO)).toBe("team");

    await blockUser(await createSupabaseServiceClient(), ADA, BO);
    expect(db.table("minion_links")).toHaveLength(1);
    expect(await getViewerRelationship(BO, ADA)).toBe("public");
    expect(await getViewerRelationship(ADA, BO)).toBe("public");
    const bulk = await getViewerRelationships(BO, [ADA, ME]);
    expect(bulk.get(ADA)).toBe("public");

    // Someone else in Ada's crew is unaffected.
    db.table("minion_links").push({ id: "m2", recruiter_id: ADA, minion_id: ME, audience_approved_at: "2026-12-01T00:00:00Z" });
    expect(await getViewerRelationship(ME, ADA)).toBe("team");
  });
});

describe("crew audience approval", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    h.user = { id: ADA, role: "adult" };
    db = seed({
      minion_links: [
        { id: "m1", recruiter_id: ADA, minion_id: ME, audience_approved_at: null },
        { id: "m2", recruiter_id: BO, minion_id: TEEN, audience_approved_at: null },
      ],
    });
  });
  const put = (body: unknown, headers: Record<string, string> = {}) =>
    setAudience(req("PUT", "/api/v1/social/referrals/audience", body, headers));
  const link = (id: string) => db.table("minion_links").find((l) => l.id === id);

  it("lets the recruiter approve and un-approve a member of their own crew", async () => {
    const yes = await put({ minion_id: ME, approved: true });
    expect(yes.status).toBe(200);
    expect(await yes.json()).toEqual({ minion_id: ME, audience_approved: true });
    expect(link("m1")?.audience_approved_at).toEqual(expect.any(String));
    expect(await getViewerRelationship(ME, ADA)).toBe("team");

    expect((await put({ minion_id: ME, approved: false })).status).toBe(200);
    expect(link("m1")?.audience_approved_at).toBeNull();
    expect(await getViewerRelationship(ME, ADA)).toBe("public");
    expect(db.table("behavioral_events").map((e) => e.event_type)).toEqual(["crew_audience_approved", "crew_audience_removed"]);
  });

  it("never lets a member approve themselves, or anyone touch another recruiter's crew", async () => {
    // The member tries to approve their own link to Ada.
    h.user = { id: ME, role: "adult" };
    expect((await put({ minion_id: ME, approved: true })).status).toBe(404);
    expect((await put({ minion_id: ADA, approved: true })).status).toBe(404);
    // Ada tries to approve someone in Bo's crew.
    h.user = { id: ADA, role: "adult" };
    expect((await put({ minion_id: TEEN, approved: true })).status).toBe(404);
    expect(link("m1")?.audience_approved_at).toBeNull();
    expect(link("m2")?.audience_approved_at).toBeNull();
    expect(db.table("behavioral_events")).toHaveLength(0);
  });

  it("validates input, sign-in and where the request came from", async () => {
    expect((await put({ minion_id: "nope", approved: true })).status).toBe(400);
    expect((await put({ minion_id: ME, approved: "yes" })).status).toBe(400);
    expect((await put({ minion_id: ME, approved: true }, { origin: "https://evil.example" })).status).toBe(403);
    h.user = null;
    expect((await put({ minion_id: ME, approved: true })).status).toBe(401);
    expect(link("m1")?.audience_approved_at).toBeNull();
  });

  it("tells an adult recruiter when someone joins, with the name they are allowed to see", async () => {
    await notifyCrewJoined(await createSupabaseServiceClient(), ADA, ME);
    const notices = db.table("notifications");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ user_id: ADA, type: "crew_joined", title: "Me joined your crew", entity_id: ME });

    // A teen recruiter's audiences don't include crews, so there is nothing to approve.
    await notifyCrewJoined(await createSupabaseServiceClient(), TEEN, ME);
    expect(notices).toHaveLength(1);
  });
});
