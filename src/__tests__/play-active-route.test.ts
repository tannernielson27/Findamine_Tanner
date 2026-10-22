import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row } from "@/__tests__/support/supabase-double";
import { parseActiveHunt } from "@/lib/play/active-hunt";
import { buildActiveHunt, lastActivity, rankSessions } from "@/lib/play/active-hunt-builder";

/**
 * GET /api/v1/play/active: the player's unfinished hunt with the latest
 * activity, with stop counts from their real completions.
 */

const h = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  const client = async () => m.current().client;
  return { createSupabaseServiceClient: client, createSupabaseServerClient: client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET } from "@/app/api/v1/play/active/route";

const COVER = "https://proj.supabase.co/storage/v1/object/public/hunt-covers/h1/abc.jpg";

function hunt(id: string, extra: Row = {}): Row {
  return {
    id,
    title: `Hunt ${id}`,
    status: "published",
    review_status: "approved",
    created_by: "creator",
    deleted_at: null,
    cover_image_url: null,
    ...extra,
  };
}

function finds(huntId: string, n: number): Row[] {
  // Inserted out of order on purpose: sort_order decides the stop number.
  return Array.from({ length: n }, (_, i) => ({ id: `${huntId}-f${i + 1}`, hunt_id: huntId, sort_order: (i + 1) * 10, deleted_at: null })).reverse();
}

const request = () => new NextRequest("http://localhost:3000/api/v1/play/active");
const embeds = { roster_entries: { "rosters!inner": { table: "rosters", localKey: "roster_id" } } };

beforeEach(() => {
  h.user = { id: "u1", role: "adult" };
});

describe("active hunt builder (pure)", () => {
  const session = { id: "s1", hunt_id: "h1", started_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:05:00Z" };

  it("uses the latest stop activity when it is newer than the session row", () => {
    const completions = [
      { play_session_id: "s1", find_id: "f1", arrived_at: "2026-10-20T11:00:00Z", completed_at: "2026-10-20T11:02:00Z", created_at: "2026-10-20T11:00:00Z" },
      { play_session_id: "other", find_id: "f1", arrived_at: null, completed_at: "2026-10-21T09:00:00Z", created_at: null },
    ];
    expect(lastActivity(session, completions)).toBe("2026-10-20T11:02:00.000Z");
  });

  it("ranks sessions by latest activity", () => {
    const older = { ...session, id: "old", updated_at: "2026-10-01T00:00:00Z", started_at: "2026-10-01T00:00:00Z" };
    const undated = { ...session, id: "none", updated_at: null, started_at: null };
    const ranked = rankSessions([undated, older, session], []);
    expect(ranked.map((s) => s.id)).toEqual(["s1", "old", "none"]);
  });

  it("counts live stops, finished stops, and resumes at the first unfinished one", () => {
    const stops = [
      { id: "a", sort_order: 1 },
      { id: "b", sort_order: 2 },
      { id: "c", sort_order: 3 },
    ];
    const completions = [
      { play_session_id: "s1", find_id: "a", arrived_at: null, completed_at: "2026-10-20T11:00:00Z", created_at: null },
      // Arrived but not finished: still the current stop.
      { play_session_id: "s1", find_id: "b", arrived_at: "2026-10-20T11:10:00Z", completed_at: null, created_at: null },
      // A stop deleted after it was finished no longer counts.
      { play_session_id: "s1", find_id: "gone", arrived_at: null, completed_at: "2026-10-20T10:30:00Z", created_at: null },
    ];
    const result = buildActiveHunt({ id: "h1", title: "T", cover_image_url: COVER }, "s1", stops, completions, "x");
    expect(result).toEqual({
      huntId: "h1",
      title: "T",
      currentStop: 2,
      totalStops: 3,
      completedStops: 1,
      href: "/play/h1",
      coverImageUrl: COVER,
      lastActiveAt: "x",
    });
    // Round-trips through the client parser unchanged.
    expect(parseActiveHunt({ data: result })).toEqual(result);
  });

  it("sits on the last stop when every stop is finished", () => {
    const stops = [{ id: "a", sort_order: 1 }];
    const done = [{ play_session_id: "s1", find_id: "a", arrived_at: null, completed_at: "2026-10-20T11:00:00Z", created_at: null }];
    expect(buildActiveHunt({ id: "h1", title: "T" }, "s1", stops, done, null)).toMatchObject({
      currentStop: 1,
      totalStops: 1,
      completedStops: 1,
      coverImageUrl: null,
    });
  });
});

describe("GET /api/v1/play/active", () => {
  it("returns { data: null } (not 401) when signed out", async () => {
    h.user = null;
    installDouble({});
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  it("returns { data: null } with no unfinished session", async () => {
    installDouble({
      hunts: [hunt("h1")],
      play_sessions: [
        { id: "s1", hunt_id: "h1", user_id: "u1", status: "completed", started_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T11:00:00Z" },
        { id: "s2", hunt_id: "h1", user_id: "u2", status: "active", started_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T11:00:00Z" },
      ],
    });
    expect(await (await GET(request())).json()).toEqual({ data: null });
  });

  it("picks the most recently active of several unfinished hunts, with real stop counts", async () => {
    installDouble({
      hunts: [hunt("h1"), hunt("h2", { cover_image_url: COVER })],
      finds: [...finds("h1", 3), ...finds("h2", 4), { id: "h2-deleted", hunt_id: "h2", sort_order: 1, deleted_at: "2026-10-01T00:00:00Z" }],
      play_sessions: [
        // Session row touched more recently...
        { id: "s1", hunt_id: "h1", user_id: "u1", status: "active", started_at: "2026-10-20T09:00:00Z", updated_at: "2026-10-21T08:00:00Z" },
        // ...but this one has a newer stop completion.
        { id: "s2", hunt_id: "h2", user_id: "u1", status: "active", started_at: "2026-10-19T09:00:00Z", updated_at: "2026-10-19T09:00:00Z" },
      ],
      find_completions: [
        { play_session_id: "s2", find_id: "h2-f1", arrived_at: "2026-10-21T09:00:00Z", completed_at: "2026-10-21T09:05:00Z", created_at: "2026-10-21T09:00:00Z" },
        { play_session_id: "s2", find_id: "h2-f2", arrived_at: "2026-10-21T09:10:00Z", completed_at: "2026-10-21T09:20:00Z", created_at: "2026-10-21T09:10:00Z" },
        { play_session_id: "s1", find_id: "h1-f1", arrived_at: "2026-10-20T09:10:00Z", completed_at: "2026-10-20T09:15:00Z", created_at: "2026-10-20T09:10:00Z" },
      ],
    });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual({
      data: {
        huntId: "h2",
        title: "Hunt h2",
        currentStop: 3,
        totalStops: 4,
        completedStops: 2,
        href: "/play/h2",
        coverImageUrl: COVER,
        lastActiveAt: "2026-10-21T09:20:00.000Z",
      },
    });
  });

  it("skips sessions whose hunt was deleted, unpublished, or is no longer open to the player", async () => {
    installDouble(
      {
        hunts: [
          hunt("deleted", { deleted_at: "2026-10-21T00:00:00Z" }),
          hunt("draft", { status: "draft", review_status: "not_submitted" }),
          hunt("rejected", { review_status: "rejected" }),
          hunt("ok"),
        ],
        finds: finds("ok", 2),
        play_sessions: [
          { id: "s1", hunt_id: "deleted", user_id: "u1", status: "active", started_at: null, updated_at: "2026-10-21T12:00:00Z" },
          { id: "s2", hunt_id: "draft", user_id: "u1", status: "active", started_at: null, updated_at: "2026-10-21T11:00:00Z" },
          { id: "s3", hunt_id: "rejected", user_id: "u1", status: "active", started_at: null, updated_at: "2026-10-21T10:00:00Z" },
          { id: "s4", hunt_id: "ok", user_id: "u1", status: "active", started_at: null, updated_at: "2026-10-01T10:00:00Z" },
        ],
      },
      { embeds }
    );
    const body = await (await GET(request())).json();
    expect(body.data).toMatchObject({ huntId: "ok", currentStop: 1, totalStops: 2, completedStops: 0 });
  });

  it("still resumes the creator's own unlisted hunt", async () => {
    installDouble({
      hunts: [hunt("mine", { created_by: "u1", review_status: "pending" })],
      finds: finds("mine", 1),
      play_sessions: [{ id: "s1", hunt_id: "mine", user_id: "u1", status: "active", started_at: "2026-10-21T10:00:00Z", updated_at: null }],
    });
    const body = await (await GET(request())).json();
    expect(body.data).toMatchObject({ huntId: "mine", lastActiveAt: "2026-10-21T10:00:00.000Z" });
  });
});
