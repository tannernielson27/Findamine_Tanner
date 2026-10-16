import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type SupabaseDouble, type Row } from "@/__tests__/support/supabase-double";

/**
 * Report / block / filter (App Store guideline 1.2) against the in-memory
 * Supabase double: the reports route, user blocks, and how blocks, reports and
 * the content filter shape team chat, kudos and friend requests.
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
  socialLimiter: { check: async () => {} },
  authLimiter: { check: async () => {} },
}));
// after() needs a live Next request scope; moderator alerts are covered in report-alerts.test.ts.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: () => {},
}));

import { POST as report } from "@/app/api/v1/reports/route";
import { GET as listBlocks, POST as block } from "@/app/api/v1/social/blocks/route";
import { DELETE as unblock } from "@/app/api/v1/social/blocks/[userId]/route";
import { GET as readChat, POST as sendChat } from "@/app/api/v1/teams/[id]/chat/route";
import { GET as listKudos, POST as sendKudos } from "@/app/api/v1/social/kudos/route";
import { POST as sendShoutout } from "@/app/api/v1/social/shoutouts/route";
import { GET as readWall } from "@/app/api/v1/social/wall/route";
import { POST as requestFriend } from "@/app/api/v1/social/friends/route";
import { GET as moderationQueue } from "@/app/api/v1/moderation/route";
import { POST as reviewReport } from "@/app/api/v1/moderation/[id]/review/route";
import { hiddenUserIds, toBlockSets, withoutAuthors } from "@/lib/moderation/blocks";
import { reportTargetFor } from "@/lib/moderation/report-targets";

const ME = "11111111-1111-4111-8111-111111111111";
const ADA = "22222222-2222-4222-8222-222222222222";
const BO = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const TEAM = "55555555-5555-4555-8555-555555555555";
const MSG_ADA = "66666666-6666-4666-8666-666666666666";
const MSG_BO = "77777777-7777-4777-8777-777777777777";
const KUDOS_ADA = "88888888-8888-4888-8888-888888888888";
const HUNT = "99999999-9999-4999-8999-999999999999";
const FIND = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_TEAM = "aaaaaaaa-0000-4000-8000-000000000002";

function seed(extra: Record<string, Row[]> = {}): SupabaseDouble {
  return installDouble(
    {
      users: [
        { id: ME, display_name: "Me", avatar_url: null, role: "student", profile_visibility: {}, deleted_at: null },
        { id: ADA, display_name: "Ada", avatar_url: null, role: "student", profile_visibility: {}, deleted_at: null },
        { id: BO, display_name: "Bo", avatar_url: null, role: "student", profile_visibility: {}, deleted_at: null },
        { id: STRANGER, display_name: "Stranger", avatar_url: null, role: "student", profile_visibility: {}, deleted_at: null },
      ],
      team_members: [
        { id: "tm1", team_id: TEAM, user_id: ME, status: "active", role: "member" },
        { id: "tm2", team_id: TEAM, user_id: ADA, status: "active", role: "member" },
        { id: "tm3", team_id: TEAM, user_id: BO, status: "active", role: "member" },
      ],
      team_messages: [
        { id: MSG_ADA, team_id: TEAM, user_id: ADA, message: "hi team", moderation_status: "approved", created_at: "2026-10-01T00:00:00Z" },
        { id: MSG_BO, team_id: TEAM, user_id: BO, message: "hello", moderation_status: "approved", created_at: "2026-10-01T00:01:00Z" },
      ],
      kudos: [{ id: KUDOS_ADA, sender_id: ADA, receiver_id: ME, message: "nice find", created_at: "2026-10-01T00:00:00Z" }],
      friend_connections: [],
      minion_links: [],
      roster_entries: [],
      user_blocks: [],
      moderation_reports: [],
      ...extra,
    },
    {
      unique: { user_blocks: [["blocker_id", "blocked_id"]] },
      embeds: {
        team_messages: { users: { table: "users", localKey: "user_id" } },
        wall_posts: { users: { table: "users", localKey: "user_id" } },
        finds: { hunts: { table: "hunts", localKey: "hunt_id" } },
      },
    }
  );
}

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const team = { params: Promise.resolve({ id: TEAM }) };
const chatIds = async () => ((await (await readChat(req("GET", `/api/v1/teams/${TEAM}/chat`), team)).json()).messages as Row[]).map((m) => m.id);

beforeEach(() => {
  h.user = { id: ME, role: "student" };
});

describe("block helpers", () => {
  it("splits rows into blocked / blocked-by and hides both directions", () => {
    const sets = toBlockSets(
      [
        { blocker_id: ME, blocked_id: ADA },
        { blocker_id: BO, blocked_id: ME },
        { blocker_id: ADA, blocked_id: BO }, // not about the viewer
      ],
      ME
    );
    expect([...sets.blocked]).toEqual([ADA]);
    expect([...sets.blockedBy]).toEqual([BO]);
    expect(hiddenUserIds(sets)).toEqual(new Set([ADA, BO]));
  });

  it("drops rows by hidden authors and keeps authorless rows", () => {
    const rows = [{ a: ADA }, { a: BO }, { a: null }];
    expect(withoutAuthors(rows, (r) => r.a, new Set([ADA]))).toEqual([{ a: BO }, { a: null }]);
  });

  it("maps report target types onto stored and legacy entity types", () => {
    expect(reportTargetFor("team_message")).toMatchObject({ stored: "message", legacy: "message" });
    expect(reportTargetFor("kudos")).toMatchObject({ stored: "kudos", legacy: "content" });
    expect(reportTargetFor("find")).toMatchObject({ stored: "content", legacy: "content" });
    expect(reportTargetFor("find").resolve).toEqual(expect.any(Function));
    expect(reportTargetFor("constructor")).toEqual({ stored: "content", legacy: "content" });
  });
});

describe("POST /reports", () => {
  it("stores the author and a snapshot of a reported chat message", async () => {
    const db = seed();
    const res = await report(req("POST", "/api/v1/reports", { category: "mean_hurtful", target_type: "message", target_id: MSG_ADA, comment: "rude" }));
    expect(res.status).toBe(200);
    expect(db.table("moderation_reports")).toEqual([
      expect.objectContaining({
        reporter_id: ME,
        entity_type: "message",
        entity_id: MSG_ADA,
        reason: "mean_hurtful",
        reported_user_id: ADA,
        content_snapshot: "hi team",
        details: "rude",
        status: "pending",
      }),
    ]);
  });

  it("hides a reported message from the reporter only", async () => {
    seed();
    await report(req("POST", "/api/v1/reports", { category: "spam", target_type: "message", target_id: MSG_ADA }));
    expect(await chatIds()).toEqual([MSG_BO]);
    h.user = { id: BO, role: "student" };
    expect(await chatIds()).toEqual([MSG_ADA, MSG_BO]);
  });

  it("reports and blocks in one step", async () => {
    const db = seed({ friend_connections: [{ id: "fc", requester_id: ME, addressee_id: ADA, status: "accepted" }] });
    const res = await report(req("POST", "/api/v1/reports", { category: "inappropriate", target_type: "kudos", target_id: KUDOS_ADA, block: true }));
    expect(await res.json()).toMatchObject({ reported: true, blocked: true });
    expect(db.table("user_blocks")).toEqual([expect.objectContaining({ blocker_id: ME, blocked_id: ADA })]);
    expect(db.table("friend_connections")).toEqual([]);
    expect(db.table("moderation_reports")[0]).toMatchObject({ entity_type: "kudos", reported_user_id: ADA, content_snapshot: "nice find" });
  });

  it("reports a user profile with their display name as context", async () => {
    const db = seed();
    await report(req("POST", "/api/v1/reports", { category: "other", target_type: "user", target_id: BO }));
    expect(db.table("moderation_reports")[0]).toMatchObject({ entity_type: "user", reported_user_id: BO, content_snapshot: "Bo" });
  });

  it("rejects reporting your own content and missing targets", async () => {
    seed();
    h.user = { id: ADA, role: "student" };
    const own = await report(req("POST", "/api/v1/reports", { category: "spam", target_type: "message", target_id: MSG_ADA }));
    expect(own.status).toBe(400);
    const gone = await report(req("POST", "/api/v1/reports", { category: "spam", target_type: "message", target_id: STRANGER }));
    expect(gone.status).toBe(404);
  });

  it("snapshots a reported hunt stop's clue and names the hunt's creator", async () => {
    const db = seed({
      hunts: [{ id: HUNT, created_by: ADA }],
      finds: [{ id: FIND, hunt_id: HUNT, clue_text: "Under the bridge" }],
    });
    const res = await report(req("POST", "/api/v1/reports", { category: "off_topic", target_type: "find", target_id: FIND }));
    expect(res.status).toBe(200);
    expect(db.table("moderation_reports")[0]).toMatchObject({
      entity_type: "content",
      details: "[find]",
      reported_user_id: ADA,
      content_snapshot: "Under the bridge",
    });
  });

  it("answers 404 for a stop that doesn't exist", async () => {
    seed({ hunts: [], finds: [] });
    const res = await report(req("POST", "/api/v1/reports", { category: "off_topic", target_type: "find", target_id: STRANGER }));
    expect(res.status).toBe(404);
  });

  it("rejects an over-long or odd target_type (L2)", async () => {
    const db = seed();
    for (const target_type of ["x".repeat(41), "<script>", "Message"]) {
      const res = await report(req("POST", "/api/v1/reports", { category: "spam", target_type, target_id: MSG_ADA }));
      expect(res.status).toBe(400);
    }
    expect(db.table("moderation_reports")).toHaveLength(0);
  });

  it("refuses a cross-site request riding the session cookie, but not a bearer one (L3)", async () => {
    const db = seed();
    const body = JSON.stringify({ category: "spam", target_type: "message", target_id: MSG_ADA });
    const forged = new NextRequest("http://localhost:3000/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body,
    });
    expect((await report(forged)).status).toBe(403);
    expect(db.table("moderation_reports")).toHaveLength(0);

    for (const origin of ["http://localhost:3000", "capacitor://localhost"]) {
      const ok = new NextRequest("http://localhost:3000/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body,
      });
      expect((await report(ok)).status).toBe(200);
    }
    const bearer = new NextRequest("http://localhost:3000/api/v1/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example", Authorization: "Bearer t" },
      body,
    });
    expect((await report(bearer)).status).toBe(200);
  });
});

describe("blocking", () => {
  it("blocks, removes the friendship, lists, and unblocks", async () => {
    const db = seed({ friend_connections: [{ id: "fc", requester_id: ADA, addressee_id: ME, status: "pending" }] });
    const res = await block(req("POST", "/api/v1/social/blocks", { user_id: ADA }));
    expect(res.status).toBe(201);
    expect(db.table("friend_connections")).toEqual([]);

    // Blocking twice is harmless.
    expect((await block(req("POST", "/api/v1/social/blocks", { user_id: ADA }))).status).toBe(201);
    expect(db.table("user_blocks")).toHaveLength(1);

    const list = await (await listBlocks(req("GET", "/api/v1/social/blocks"))).json();
    expect(list.blocks.map((b: Row) => b.user_id)).toEqual([ADA]);
    const one = await (await listBlocks(req("GET", `/api/v1/social/blocks?user_id=${ADA}`))).json();
    expect(one).toEqual({ blocked: true });

    await unblock(req("DELETE", `/api/v1/social/blocks/${ADA}`), { params: Promise.resolve({ userId: ADA }) });
    expect(db.table("user_blocks")).toEqual([]);
  });

  it("rejects blocking yourself or an unknown player", async () => {
    seed();
    expect((await block(req("POST", "/api/v1/social/blocks", { user_id: ME }))).status).toBe(400);
    expect((await block(req("POST", "/api/v1/social/blocks", { user_id: "99999999-9999-4999-8999-999999999999" }))).status).toBe(404);
  });

  it("hides chat messages both ways without revealing who blocked the viewer (M1)", async () => {
    seed({ user_blocks: [{ id: "b1", blocker_id: ADA, blocked_id: ME }] });
    const body = await (await readChat(req("GET", `/api/v1/teams/${TEAM}/chat`), team)).json();
    expect(body.messages.map((m: Row) => m.id)).toEqual([MSG_BO]);
    // ADA blocked ME: her messages are gone, but her id is not handed over.
    expect(body.hidden_user_ids).toEqual([]);
  });

  it("lists the people the viewer blocked, for filtering realtime messages", async () => {
    seed({ user_blocks: [{ id: "b1", blocker_id: ME, blocked_id: ADA }] });
    const body = await (await readChat(req("GET", `/api/v1/teams/${TEAM}/chat`), team)).json();
    expect(body.messages.map((m: Row) => m.id)).toEqual([MSG_BO]);
    expect(body.hidden_user_ids).toEqual([ADA]);
  });

  it("rejects a non-UUID unblock target (L8) and a cross-site block", async () => {
    seed();
    const res = await unblock(req("DELETE", "/api/v1/social/blocks/not-a-uuid"), { params: Promise.resolve({ userId: "not-a-uuid" }) });
    expect(res.status).toBe(400);
    const forged = new NextRequest("http://localhost:3000/api/v1/social/blocks", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ user_id: ADA }),
    });
    expect((await block(forged)).status).toBe(403);
  });

  it("hides kudos from a blocked player", async () => {
    seed({ user_blocks: [{ id: "b1", blocker_id: ME, blocked_id: ADA }] });
    const body = await (await listKudos(req("GET", "/api/v1/social/kudos?type=all"))).json();
    expect(body.kudos).toEqual([]);
  });

  it("stops friend requests in either direction", async () => {
    seed({ user_blocks: [{ id: "b1", blocker_id: ADA, blocked_id: ME }] });
    const res = await requestFriend(req("POST", "/api/v1/social/friends", { addressee_id: ADA }));
    expect(res.status).toBe(403);
  });
});

describe("POST /teams/[id]/chat filter", () => {
  it("rejects objectionable messages with a friendly error", async () => {
    const db = seed();
    const res = await sendChat(req("POST", `/api/v1/teams/${TEAM}/chat`, { message: "you are a b1tch" }), team);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/isn't allowed/);
    expect(db.table("team_messages")).toHaveLength(2);
  });

  it("uses the strict filter for children", async () => {
    seed({ team_members: [{ id: "tm9", team_id: TEAM, user_id: ME, status: "active", role: "member" }] });
    h.user = { id: ME, role: "child" };
    expect((await sendChat(req("POST", `/api/v1/teams/${TEAM}/chat`, { message: "ur stupid" }), team)).status).toBe(422);
    h.user = { id: ME, role: "teen" };
    expect((await sendChat(req("POST", `/api/v1/teams/${TEAM}/chat`, { message: "ur stupid" }), team)).status).toBe(201);
  });
});

describe("POST /social/kudos", () => {
  const send = (receiver: string, message = "Great teamwork!") =>
    sendKudos(req("POST", "/api/v1/social/kudos", { receiver_id: receiver, message }));

  it("sends to a teammate", async () => {
    seed();
    expect((await send(ADA)).status).toBe(201);
  });

  it("sends to an accepted friend or crew member who isn't a teammate", async () => {
    seed({
      friend_connections: [{ id: "fc", requester_id: STRANGER, addressee_id: ME, status: "accepted" }],
    });
    expect((await send(STRANGER)).status).toBe(201);
    seed({ minion_links: [{ id: "ml", recruiter_id: ME, minion_id: STRANGER }] });
    expect((await send(STRANGER)).status).toBe(201);
  });

  it("refuses strangers and pending friend requests", async () => {
    seed({ friend_connections: [{ id: "fc", requester_id: ME, addressee_id: STRANGER, status: "pending" }] });
    const res = await send(STRANGER);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/friends, crew, teammates and classmates/);
  });

  it("refuses across a block even between teammates", async () => {
    seed({ user_blocks: [{ id: "b1", blocker_id: ADA, blocked_id: ME }] });
    expect((await send(ADA)).status).toBe(403);
  });

  it("filters the message", async () => {
    const db = seed();
    expect((await send(ADA, "kys")).status).toBe(422);
    expect(db.table("kudos")).toHaveLength(1);
  });

  it("marks each kudos as sent or received for the viewer", async () => {
    seed();
    await send(ADA);
    const body = await (await listKudos(req("GET", "/api/v1/social/kudos?type=all"))).json();
    expect(body.kudos.map((k: Row) => k.direction).sort()).toEqual(["received", "sent"]);
  });
});

describe("POST /social/shoutouts", () => {
  const send = (receiver: string, message = "Way to go!") =>
    sendShoutout(req("POST", "/api/v1/social/shoutouts", { receiver_id: receiver, message }));

  it("sends to a teammate", async () => {
    const db = seed({ shoutouts: [] });
    expect((await send(ADA)).status).toBe(201);
    expect(db.table("shoutouts")).toHaveLength(1);
  });

  it("refuses strangers, like kudos", async () => {
    const db = seed({ shoutouts: [] });
    const res = await send(STRANGER);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/friends, crew, teammates and classmates/);
    expect(db.table("shoutouts")).toHaveLength(0);
  });

  it("refuses a malformed receiver id", async () => {
    seed({ shoutouts: [] });
    expect((await send("nope")).status).toBe(404);
  });
});

describe("GET /social/wall", () => {
  const wall = (teamId = TEAM) => readWall(req("GET", `/api/v1/social/wall?team_id=${teamId}`));
  const posts = () => [
    { id: "p1", team_id: TEAM, user_id: ADA, content: "anon", is_anonymous: true, moderation_status: "approved", created_at: "2026-10-01T00:00:00Z" },
    { id: "p2", team_id: TEAM, user_id: BO, content: "named", is_anonymous: false, moderation_status: "approved", created_at: "2026-10-01T00:01:00Z" },
    { id: "p3", team_id: TEAM, user_id: ME, content: "mine", is_anonymous: true, moderation_status: "approved", created_at: "2026-10-01T00:02:00Z" },
  ];

  it("strips the author from anonymous posts server-side", async () => {
    seed({ wall_posts: posts() });
    const body = await (await wall()).json();
    const byId = Object.fromEntries((body.posts as Row[]).map((p) => [p.id, p]));
    expect(byId.p1.user_id).toBeNull();
    expect(byId.p1.users).toBeNull();
    expect(byId.p2.user_id).toBe(BO);
    // The author still sees their own anonymous post as theirs.
    expect(byId.p3.user_id).toBe(ME);
  });

  it("lets an admin see who wrote an anonymous post", async () => {
    seed({ wall_posts: posts() });
    h.user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "admin" };
    const body = await (await wall()).json();
    expect((body.posts as Row[]).find((p) => p.id === "p1")?.user_id).toBe(ADA);
  });

  it("is only readable by the team's members (or whoever runs the hunt)", async () => {
    seed({
      wall_posts: posts(),
      teams: [{ id: OTHER_TEAM, hunt_id: HUNT, name: "Other", status: "ready", max_size: 4 }],
      hunts: [{ id: HUNT, title: "H", play_mode: "team_assigned", status: "published", created_by: BO, max_team_size: 4, max_teams: null }],
    });
    expect((await wall(OTHER_TEAM)).status).toBe(403);
    h.user = { id: BO, role: "teacher" };
    expect((await wall(OTHER_TEAM)).status).toBe(200);
  });
});

describe("moderation review (admin only)", () => {
  const ADMIN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const reportRow = (over: Row = {}): Row => ({
    id: "r1",
    reporter_id: ME,
    entity_type: "message",
    entity_id: MSG_ADA,
    reason: "mean_hurtful",
    status: "pending",
    reported_user_id: ADA,
    content_snapshot: "hi team",
    ...over,
  });
  const review = (body: unknown, id = "r1") =>
    reviewReport(req("POST", `/api/v1/moderation/${id}/review`, body), { params: Promise.resolve({ id }) });

  it("keeps self-selectable roles out of the queue and away from removal", async () => {
    const db = seed({ moderation_reports: [reportRow()] });
    for (const role of ["teacher", "hunt_creator", "researcher", "student"]) {
      h.user = { id: BO, role };
      expect((await moderationQueue(req("GET", "/api/v1/moderation"))).status).toBe(403);
      expect((await review({ status: "actioned", remove_content: true })).status).toBe(403);
    }
    expect(db.table("team_messages").find((m) => m.id === MSG_ADA)?.moderation_status).toBe("approved");
    expect(db.table("moderation_reports")[0].status).toBe("pending");
  });

  it("won't let an admin act on a report they filed or one about them", async () => {
    seed({
      moderation_reports: [reportRow({ reporter_id: ADMIN }), reportRow({ id: "r2", reported_user_id: ADMIN })],
    });
    h.user = { id: ADMIN, role: "admin" };
    expect((await review({ status: "dismissed" })).status).toBe(403);
    expect((await review({ status: "dismissed" }, "r2")).status).toBe(403);
  });

  it("lets an admin soft-remove a chat message or kudos and resolve the report", async () => {
    const db = seed({
      moderation_reports: [reportRow(), reportRow({ id: "r2", entity_type: "kudos", entity_id: KUDOS_ADA })],
    });
    h.user = { id: ADMIN, role: "admin" };
    expect((await review({ status: "actioned", remove_content: true })).status).toBe(200);
    expect((await review({ status: "actioned", remove_content: true }, "r2")).status).toBe(200);
    expect(db.table("team_messages").find((m) => m.id === MSG_ADA)?.moderation_status).toBe("removed");
    expect(db.table("kudos")).toEqual([expect.objectContaining({ id: KUDOS_ADA, moderation_status: "removed" })]);
    expect(db.table("moderation_reports").map((r) => [r.status, r.action_taken, r.reviewed_by])).toEqual([
      ["actioned", "content_removed", ADMIN],
      ["actioned", "content_removed", ADMIN],
    ]);

    // Removed kudos no longer show up for the recipient.
    h.user = { id: ME, role: "student" };
    expect((await (await listKudos(req("GET", "/api/v1/social/kudos"))).json()).kudos).toEqual([]);
  });

  it("only removes content as part of an actioned resolution", async () => {
    seed({ moderation_reports: [reportRow()] });
    h.user = { id: ADMIN, role: "admin" };
    expect((await review({ status: "dismissed", remove_content: true })).status).toBe(400);
  });
});
