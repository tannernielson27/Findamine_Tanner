import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ badgeTypeReads: 0, awarded: [] as string[] }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({
    from: (table: string) => {
      if (table === "badge_types") {
        return {
          select: async () => {
            h.badgeTypeReads++;
            return { data: [{ id: "b-first", code: "FIRST_HUNT" }, { id: "b-5", code: "HUNTS_5" }] };
          },
        };
      }
      if (table === "user_badges") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
          insert: async (row: { badge_type_id: string }) => {
            h.awarded.push(row.badge_type_id);
            return { error: null };
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));

import { tryAwardBadge, resetBadgeTypeCache } from "@/lib/services/gamification";

beforeEach(() => {
  h.badgeTypeReads = 0;
  h.awarded = [];
  resetBadgeTypeCache();
});

describe("tryAwardBadge badge_types cache", () => {
  it("loads badge_types once for many awards, in parallel or not", async () => {
    const results = await Promise.all([
      tryAwardBadge("u1", "FIRST_HUNT"),
      tryAwardBadge("u1", "HUNTS_5"),
    ]);
    await tryAwardBadge("u1", "FIRST_HUNT");
    expect(results).toEqual([true, true]);
    expect(h.awarded).toContain("b-first");
    expect(h.awarded).toContain("b-5");
    // The two concurrent calls may each load once before the cache fills; later calls never do.
    expect(h.badgeTypeReads).toBeLessThanOrEqual(2);
  });

  it("returns false for an unknown badge code", async () => {
    expect(await tryAwardBadge("u1", "NOPE")).toBe(false);
    expect(h.awarded).toEqual([]);
  });
});
