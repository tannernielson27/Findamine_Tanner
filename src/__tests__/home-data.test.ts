import { describe, it, expect } from "vitest";
import {
  audiencesForBand,
  buildFriendActivity,
  initialsOf,
  recentlyKudosed,
  streakLine,
  timeAgo,
  weeklyHeadline,
  withDistances,
  type FriendRowLite,
  type KudosLite,
} from "@/components/home/home-data";
import { dayPart, greetingFor, timeOfDayLine } from "@/components/home/greeting";
import { stopLine } from "@/components/layout/mini-bar";
import type { HuntCardData } from "@/lib/hunts/card-data";

const NOW = Date.parse("2026-10-21T18:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("greeting", () => {
  it("splits the day into four parts", () => {
    expect(dayPart(5)).toBe("morning");
    expect(dayPart(11)).toBe("morning");
    expect(dayPart(12)).toBe("afternoon");
    expect(dayPart(16)).toBe("afternoon");
    expect(dayPart(17)).toBe("evening");
    expect(dayPart(20)).toBe("evening");
    expect(dayPart(21)).toBe("night");
    expect(dayPart(2)).toBe("night");
  });

  it("formats the weekday line in local time", () => {
    expect(timeOfDayLine(new Date(2026, 9, 20, 14, 0))).toBe("Tuesday afternoon");
  });

  it("greets by name, or generically without one", () => {
    expect(greetingFor("Tanner")).toBe("Hey, Tanner");
    expect(greetingFor("  ")).toBe("Hey there");
    expect(greetingFor(null)).toBe("Hey there");
  });
});

describe("audiencesForBand", () => {
  it("keeps kids' hunts away from adults", () => {
    expect(audiencesForBand("adult")).toEqual(["adults", "all"]);
    expect(audiencesForBand("adult")).not.toContain("kids");
  });

  it("gives teens and kids their own hunts plus family and all", () => {
    expect(audiencesForBand("teen")).toEqual(["teens", "family", "all"]);
    expect(audiencesForBand("primary")).toEqual(["kids", "family", "all"]);
    expect(audiencesForBand("intermediate")).toEqual(["kids", "family", "all"]);
  });
});

describe("weekly ring copy", () => {
  it("counts down to the goal", () => {
    expect(weeklyHeadline({ completedThisWeek: 0, goal: 3, streakWeeks: 0 })).toBe("3 hunts this week");
    expect(weeklyHeadline({ completedThisWeek: 1, goal: 3, streakWeeks: 0 })).toBe("2 more hunts this week");
    expect(weeklyHeadline({ completedThisWeek: 2, goal: 3, streakWeeks: 0 })).toBe("One more hunt this week");
    expect(weeklyHeadline({ completedThisWeek: 3, goal: 3, streakWeeks: 0 })).toBe("Weekly goal done");
    expect(weeklyHeadline({ completedThisWeek: 5, goal: 3, streakWeeks: 0 })).toBe("Weekly goal done");
  });

  it("describes the streak", () => {
    expect(streakLine(0)).toBe("Finish a hunt to start a streak");
    expect(streakLine(4)).toBe("4-week streak");
  });
});

describe("timeAgo / initialsOf / stopLine", () => {
  it("formats relative times", () => {
    expect(timeAgo(new Date(NOW - 10_000).toISOString(), NOW)).toBe("just now");
    expect(timeAgo(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe("5m ago");
    expect(timeAgo(hoursAgo(2), NOW)).toBe("2h ago");
    expect(timeAgo(hoursAgo(26), NOW)).toBe("Yesterday");
    expect(timeAgo(hoursAgo(72), NOW)).toBe("3d ago");
    expect(timeAgo(null, NOW)).toBe("");
    expect(timeAgo("not a date", NOW)).toBe("");
  });

  it("takes up to two initials", () => {
    expect(initialsOf("Maya Jensen")).toBe("MJ");
    expect(initialsOf("eli")).toBe("E");
    expect(initialsOf("A B C")).toBe("AB");
    expect(initialsOf("")).toBe("?");
    expect(initialsOf(null)).toBe("?");
  });

  it("describes the current stop", () => {
    expect(stopLine({ currentStop: 3, totalStops: 7 })).toBe("Stop 3 of 7");
    expect(stopLine({ currentStop: 9, totalStops: 7 })).toBe("Stop 7 of 7");
    expect(stopLine({ currentStop: 2, totalStops: 0 })).toBe("Stop 2");
  });
});

describe("buildFriendActivity", () => {
  const friend = (id: string, name: string | null, status = "accepted"): FriendRowLite => ({
    status,
    created_at: hoursAgo(500),
    friend: { id, display_name: name },
  });
  const kudos = (id: string, from: string, h: number, direction: "sent" | "received" = "received", to = "me"): KudosLite => ({
    id,
    message: "Great job!",
    created_at: hoursAgo(h),
    sender_id: direction === "received" ? from : "me",
    receiver_id: direction === "received" ? "me" : to,
    direction,
    sender: { display_name: from.toUpperCase() },
  });

  it("lists received kudos newest first, one row per sender", () => {
    const items = buildFriendActivity([], [kudos("k1", "a", 5), kudos("k2", "b", 1), kudos("k3", "a", 2)], 4, NOW);
    expect(items.map((i) => i.personId)).toEqual(["b", "a"]);
    expect(items[0]).toMatchObject({ name: "B", action: "sent you kudos", detail: "“Great job!” · 1h ago" });
  });

  it("fills up with accepted friends, skipping pending and duplicates", () => {
    const items = buildFriendActivity(
      [friend("a", "Ann"), friend("p", "Pending", "pending"), friend("c", null)],
      [kudos("k1", "a", 1)],
      4,
      NOW
    );
    expect(items.map((i) => i.personId)).toEqual(["a", "c"]);
    expect(items[1]).toMatchObject({ name: "Friend", action: "is your friend" });
  });

  it("ignores kudos the viewer sent and respects the limit", () => {
    const items = buildFriendActivity(
      [friend("a", "A"), friend("b", "B"), friend("c", "C")],
      [kudos("k1", "x", 1, "sent", "a")],
      2,
      NOW
    );
    expect(items.map((i) => i.personId)).toEqual(["a", "b"]);
  });

  it("returns nothing with no friends and no kudos (empty state)", () => {
    expect(buildFriendActivity([], [], 4, NOW)).toEqual([]);
  });

  it("truncates long kudos messages", () => {
    const long: KudosLite = { ...kudos("k1", "a", 1), message: "x".repeat(100) };
    const [item] = buildFriendActivity([], [long], 4, NOW);
    expect(item.detail.startsWith(`“${"x".repeat(57)}…”`)).toBe(true);
  });
});

describe("recentlyKudosed", () => {
  it("collects receivers of kudos sent in the last day only", () => {
    const sent = (to: string, h: number): KudosLite => ({
      id: `${to}${h}`,
      message: "hi",
      created_at: hoursAgo(h),
      sender_id: "me",
      receiver_id: to,
      direction: "sent",
      sender: null,
    });
    const set = recentlyKudosed([sent("a", 2), sent("b", 30)], NOW);
    expect([...set]).toEqual(["a"]);
  });
});

describe("withDistances", () => {
  const hunts: HuntCardData[] = [
    { id: "far", title: "Far", latitude: 40.3, longitude: -111.6 },
    { id: "none", title: "No centre", latitude: null, longitude: null },
    { id: "near", title: "Near", latitude: 40.2519, longitude: -111.6493 },
  ];

  it("sorts located hunts nearest first and keeps unlocated ones last", () => {
    const out = withDistances(hunts, { lat: 40.2518, lng: -111.6493 });
    expect(out.map((h) => h.id)).toEqual(["near", "far", "none"]);
    expect(out[0].distanceMeters).toBeLessThan(50);
    expect(out[2].distanceMeters).toBeNull();
  });

  it("does not mutate the input", () => {
    withDistances(hunts, { lat: 0, lng: 0 });
    expect(hunts[0]).not.toHaveProperty("distanceMeters");
  });
});
