import { describe, expect, it } from "vitest";
import { audienceLabel, cardStats, safeCoverUrl, distanceMeters, formatDistance, shortPlayMode, toHuntCardData } from "@/lib/hunts/card-data";
import { toneForHunt } from "@/components/ui/topo-cover";
import { parseActiveHunt } from "@/lib/play/active-hunt";

describe("formatDistance", () => {
  it("shows miles with one decimal", () => {
    expect(formatDistance(322)).toBe("0.2 mi");
    expect(formatDistance(2897)).toBe("1.8 mi");
  });
  it("shows feet under a tenth of a mile", () => {
    expect(formatDistance(50)).toBe("160 ft");
    expect(formatDistance(1)).toBe("10 ft");
  });
  it("rounds long distances to whole miles", () => {
    expect(formatDistance(30000)).toBe("19 mi");
  });
  it("returns null for missing or bad input", () => {
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(undefined)).toBeNull();
    expect(formatDistance(-5)).toBeNull();
    expect(formatDistance(Number.NaN)).toBeNull();
  });
});

describe("distanceMeters", () => {
  it("is zero for the same point and ~111 km per degree of latitude", () => {
    expect(distanceMeters({ lat: 40.25, lng: -111.65 }, { lat: 40.25, lng: -111.65 })).toBe(0);
    const d = distanceMeters({ lat: 40, lng: -111 }, { lat: 41, lng: -111 });
    expect(d).toBeGreaterThan(110000);
    expect(d).toBeLessThan(112500);
  });
});

describe("card stats", () => {
  it("orders distance, stops, minutes, mode and skips missing values", () => {
    expect(
      cardStats({ id: "a", title: "T", distanceMeters: 322, stopCount: 6, durationMinutes: 45, playMode: "solo" })
    ).toEqual(["0.2 mi", "6 stops", "45 min", "Solo"]);
    expect(cardStats({ id: "a", title: "T", stopCount: 1, playMode: "team_assigned" })).toEqual(["1 stop", "Team"]);
    expect(cardStats({ id: "a", title: "T" })).toEqual([]);
  });
  it("maps play modes and audiences to short labels", () => {
    expect(shortPlayMode("team_self_select")).toBe("Team");
    expect(shortPlayMode("solo")).toBe("Solo");
    expect(shortPlayMode(null)).toBeNull();
    expect(audienceLabel("adults")).toBe("Adults");
    expect(audienceLabel("all")).toBe("All ages");
    expect(audienceLabel("weird")).toBeNull();
  });
  it("maps a list row, reading the embedded finds count", () => {
    const card = toHuntCardData({
      id: "h1",
      title: "Walk",
      target_audience: "adults",
      play_mode: "solo",
      estimated_duration_min: 50,
      center_latitude: 40.1,
      center_longitude: -111.6,
      cover_image_url: "https://x/y.jpg",
      finds: [{ count: 7 }],
    });
    expect(card).toMatchObject({ stopCount: 7, durationMinutes: 50, latitude: 40.1, coverImageUrl: "https://x/y.jpg" });
    expect(toHuntCardData({ id: "h2", title: "No finds" }).stopCount).toBeNull();
  });
});

describe("toneForHunt", () => {
  it("uses title keywords first", () => {
    expect(toneForHunt("x", "BYU Campus Ecology Walk")).toBe("juniper");
    expect(toneForHunt("x", "BYU Heritage Walk")).toBe("sky");
    expect(toneForHunt("x", "Campus Navigator Challenge")).toBe("blaze");
  });
  it("is stable per id when no keyword matches", () => {
    const a = toneForHunt("6e0e8fd8-83dd-5d14", "Untitled");
    expect(toneForHunt("6e0e8fd8-83dd-5d14", "Untitled")).toBe(a);
    expect(["blaze", "juniper", "sky"]).toContain(a);
  });
});

describe("parseActiveHunt", () => {
  it("returns null for empty or malformed payloads", () => {
    expect(parseActiveHunt(null)).toBeNull();
    expect(parseActiveHunt({ data: null })).toBeNull();
    expect(parseActiveHunt({ data: { huntId: 3 } })).toBeNull();
  });
  it("fills safe defaults and clamps counts", () => {
    const hunt = parseActiveHunt({ data: { huntId: "h", title: "Walk", totalStops: 7, completedStops: 9, href: "https://evil" } });
    expect(hunt).toEqual({
      huntId: "h",
      title: "Walk",
      totalStops: 7,
      completedStops: 7,
      currentStop: 1,
      href: "/play/h",
      coverImageUrl: null,
      lastActiveAt: null,
    });
  });
});

describe("safeCoverUrl", () => {
  const base = "https://abc.supabase.co";
  it("keeps covers in this project's hunt-covers bucket", () => {
    const url = `${base}/storage/v1/object/public/hunt-covers/6e0e8fd8-83dd-4d14-a86b-14ef2286656b/x.jpg`;
    expect(safeCoverUrl(url, base)).toBe(url);
  });
  it("drops other hosts, other buckets, credentials and junk", () => {
    expect(safeCoverUrl("https://evil.example/storage/v1/object/public/hunt-covers/a/x.jpg", base)).toBeNull();
    expect(safeCoverUrl(`${base}/storage/v1/object/public/avatars/a/x.jpg`, base)).toBeNull();
    expect(safeCoverUrl(`https://u:p@abc.supabase.co/storage/v1/object/public/hunt-covers/a/x.jpg`, base)).toBeNull();
    expect(safeCoverUrl("javascript:alert(1)", base)).toBeNull();
    expect(safeCoverUrl("not a url", base)).toBeNull();
    expect(safeCoverUrl(null, base)).toBeNull();
    expect(safeCoverUrl(`${base}/storage/v1/object/public/hunt-covers/a/x.jpg`, undefined)).toBeNull();
  });
});
