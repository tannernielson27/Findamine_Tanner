import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble } from "@/__tests__/support/supabase-double";
import { WEEKLY_HUNT_GOAL } from "@/lib/gamification/weekly";
import { computeWeeklyProgress, shiftWeek, weekKey } from "@/lib/gamification/weekly-stats";

/**
 * GET /api/v1/gamification/weekly: hunts completed this Denver week and the
 * run of consecutive weeks with at least one completed hunt.
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

import { GET } from "@/app/api/v1/gamification/weekly/route";

// Wednesday 2026-10-21, 12:00 in Denver (MDT, UTC-6). The week began Monday
// 2026-10-19 00:00 MDT = 06:00Z.
const NOW = new Date("2026-10-21T18:00:00Z");

describe("weekKey (pure)", () => {
  it("starts the week at Monday 00:00 Denver time, not UTC", () => {
    expect(weekKey(new Date("2026-10-19T06:00:00Z"))).toBe("2026-10-19"); // Mon 00:00 MDT
    expect(weekKey(new Date("2026-10-19T05:59:00Z"))).toBe("2026-10-12"); // Sun 23:59 MDT
    expect(weekKey(new Date("2026-10-26T05:00:00Z"))).toBe("2026-10-19"); // Sun 23:00 MDT
  });

  it("follows the DST change (MST after 2026-11-01)", () => {
    expect(weekKey(new Date("2026-11-02T06:30:00Z"))).toBe("2026-10-26"); // Sun 23:30 MST
    expect(weekKey(new Date("2026-11-02T07:00:00Z"))).toBe("2026-11-02"); // Mon 00:00 MST
    expect(shiftWeek("2026-11-02", -1)).toBe("2026-10-26");
  });
});

describe("computeWeeklyProgress (pure)", () => {
  it("is empty with no completions", () => {
    expect(computeWeeklyProgress([], NOW)).toEqual({ completedThisWeek: 0, goal: WEEKLY_HUNT_GOAL, streakWeeks: 0 });
  });

  it("counts this week's completions and includes this week in the streak once it has one", () => {
    const result = computeWeeklyProgress(
      ["2026-10-20T15:00:00Z", "2026-10-21T16:00:00Z", "2026-10-14T15:00:00Z", "2026-10-07T15:00:00Z"],
      NOW
    );
    expect(result).toEqual({ completedThisWeek: 2, goal: WEEKLY_HUNT_GOAL, streakWeeks: 3 });
  });

  it("does not break the streak just because this week has no hunt yet", () => {
    const result = computeWeeklyProgress(["2026-10-14T15:00:00Z", "2026-10-07T15:00:00Z"], NOW);
    expect(result).toMatchObject({ completedThisWeek: 0, streakWeeks: 2 });
  });

  it("stops the streak at the first week without a completion", () => {
    // This week, last week, then a gap (week of 10-05 empty), then 09-28.
    const result = computeWeeklyProgress(
      ["2026-10-20T15:00:00Z", "2026-10-13T15:00:00Z", "2026-09-29T15:00:00Z"],
      NOW
    );
    expect(result.streakWeeks).toBe(2);
  });

  it("is zero when the last completion was two weeks ago", () => {
    expect(computeWeeklyProgress(["2026-10-06T15:00:00Z"], NOW).streakWeeks).toBe(0);
  });

  it("puts a late-Sunday-night completion in the week it happened in Denver", () => {
    // Sun 2026-10-18 23:30 MDT: last week, not this one.
    const result = computeWeeklyProgress(["2026-10-19T05:30:00Z"], NOW);
    expect(result).toMatchObject({ completedThisWeek: 0, streakWeeks: 1 });
  });

  it("ignores missing, invalid and future timestamps", () => {
    const result = computeWeeklyProgress([null, undefined, "not a date", "2026-10-30T00:00:00Z"], NOW);
    expect(result).toMatchObject({ completedThisWeek: 0, streakWeeks: 0 });
  });
});

describe("GET /api/v1/gamification/weekly", () => {
  const request = () => new NextRequest("http://localhost:3000/api/v1/gamification/weekly");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    h.user = { id: "u1", role: "adult" };
  });

  it("401s when signed out", async () => {
    h.user = null;
    installDouble({});
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it("counts only the caller's completed sessions", async () => {
    installDouble({
      play_sessions: [
        { id: "s1", user_id: "u1", status: "completed", completed_at: "2026-10-20T15:00:00Z" },
        { id: "s2", user_id: "u1", status: "completed", completed_at: "2026-10-13T15:00:00Z" },
        // Still in progress: not a completed hunt.
        { id: "s3", user_id: "u1", status: "active", completed_at: null },
        // Abandoned (study withdrawal) with a stray timestamp: not completed.
        { id: "s4", user_id: "u1", status: "abandoned", completed_at: "2026-10-21T10:00:00Z" },
        // Someone else's.
        { id: "s5", user_id: "u2", status: "completed", completed_at: "2026-10-21T10:00:00Z" },
      ],
    });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    expect(await res.json()).toEqual({ data: { completedThisWeek: 1, goal: WEEKLY_HUNT_GOAL, streakWeeks: 2 } });
  });

  it("returns an empty week for a new player", async () => {
    installDouble({ play_sessions: [] });
    const res = await GET(request());
    expect(await res.json()).toEqual({ data: { completedThisWeek: 0, goal: WEEKLY_HUNT_GOAL, streakWeeks: 0 } });
  });
});
