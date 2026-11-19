import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: async () => ({}) }));
vi.mock("@/app/(app)/browse/viewer", () => ({ getBrowseViewer: async () => null }));

import { startArea, type DetailFind } from "@/app/(app)/browse/[id]/detail-data";

/**
 * The hunt page's map (issue #16): a player must not learn where stop 1 is
 * before starting it in play, so they are shown the hunt's general area.
 */

const stop = (latitude: number, longitude: number): DetailFind => ({
  id: "f0",
  sort_order: 0,
  deleted_at: null,
  clue_text: null,
  clue_hints: null,
  locations: { name: "Bell Tower", latitude, longitude, radius_meters: 60 },
  tasks: null,
  primers: null,
});

describe("startArea", () => {
  const finds = [stop(40.25, -111.65)];

  it("shows players the hunt centre, never the first stop", () => {
    expect(startArea(finds, 40.2, -111.6)).toEqual({ lat: 40.2, lng: -111.6, radius: 150 });
    expect(startArea(finds, 40.2, -111.6, { firstStop: false })).toEqual({ lat: 40.2, lng: -111.6, radius: 150 });
  });

  it("shows players nothing when the hunt has no centre, rather than fall back to a stop", () => {
    expect(startArea(finds, null, null)).toBeNull();
  });

  it("shows the owner and reviewers the first stop's arrival area", () => {
    expect(startArea(finds, 40.2, -111.6, { firstStop: true })).toEqual({ lat: 40.25, lng: -111.65, radius: 60 });
  });
});
