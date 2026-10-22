import { describe, it, expect } from "vitest";
import {
  applyFilters,
  audienceOrFilter,
  audienceSetLabel,
  defaultAudiencesFor,
  exploreHref,
  hasPhotoChallenge,
  isCampusHunt,
  isNewHunt,
  isShortHunt,
  isTeamHunt,
  parseFilters,
  popularCampusHunts,
  resolveAudience,
  serializeFilters,
  toExploreHunt,
  toggleFilter,
  withDistances,
  type ExploreHunt,
} from "@/lib/hunts/explore-filters";

const NOW = new Date("2026-10-21T12:00:00Z");

function hunt(overrides: Partial<ExploreHunt> = {}): ExploreHunt {
  return {
    id: "h1",
    title: "Provo History Trail",
    description: null,
    playMode: "solo",
    durationMinutes: 50,
    createdAt: "2026-01-01T00:00:00Z",
    tags: [],
    challengeTypes: ["multiple_choice"],
    latitude: null,
    longitude: null,
    ...overrides,
  };
}

describe("parseFilters / serializeFilters", () => {
  it("keeps known ids in chip order and drops unknown or duplicate ones", () => {
    expect(parseFilters("new,near,bogus,near,TEAM")).toEqual(["near", "team", "new"]);
  });

  it("handles missing, empty and repeated params", () => {
    expect(parseFilters(undefined)).toEqual([]);
    expect(parseFilters("")).toEqual([]);
    expect(parseFilters(["short", "photo"])).toEqual(["short", "photo"]);
  });

  it("never lets filter syntax through", () => {
    expect(parseFilters("near),or=(id.eq.1")).toEqual([]);
  });

  it("serializes to null when nothing is on, and round-trips", () => {
    expect(serializeFilters([])).toBeNull();
    expect(serializeFilters(["new", "campus"])).toBe("campus,new");
    expect(parseFilters(serializeFilters(["photo", "short"]))).toEqual(["short", "photo"]);
  });

  it("toggles without mutating the input", () => {
    const before = ["short"] as const;
    expect(toggleFilter(before, "near")).toEqual(["near", "short"]);
    expect(toggleFilter(before, "short")).toEqual([]);
    expect(before).toEqual(["short"]);
  });
});

describe("chip predicates", () => {
  it("Under 30 min includes 30 and excludes unknown durations", () => {
    expect(isShortHunt({ durationMinutes: 30 })).toBe(true);
    expect(isShortHunt({ durationMinutes: 31 })).toBe(false);
    expect(isShortHunt({ durationMinutes: null })).toBe(false);
    expect(isShortHunt({ durationMinutes: 0 })).toBe(false);
  });

  it("Campus matches campus or BYU in the title, description or tags", () => {
    expect(isCampusHunt({ title: "BYU Heritage Walk", description: null, tags: [] })).toBe(true);
    expect(isCampusHunt({ title: "Ecology Walk", description: "Around campus", tags: [] })).toBe(true);
    expect(isCampusHunt({ title: "Walk", description: "Brigham Young University grounds", tags: [] })).toBe(true);
    expect(isCampusHunt({ title: "Provo Trail", description: "Downtown", tags: ["history_community"] })).toBe(false);
    // Whole words only.
    expect(isCampusHunt({ title: "Byungwoo's park", description: null, tags: [] })).toBe(false);
  });

  it("Photo challenges needs a photo_observation task", () => {
    expect(hasPhotoChallenge({ challengeTypes: ["photo_observation", "short_text"] })).toBe(true);
    expect(hasPhotoChallenge({ challengeTypes: ["sketch_draw"] })).toBe(false);
  });

  it("Team matches every team_* play mode", () => {
    expect(isTeamHunt({ playMode: "team_self_select" })).toBe(true);
    expect(isTeamHunt({ playMode: "team_assigned" })).toBe(true);
    expect(isTeamHunt({ playMode: "solo" })).toBe(false);
    expect(isTeamHunt({ playMode: null })).toBe(false);
  });

  it("New means created in the last 30 days", () => {
    expect(isNewHunt({ createdAt: "2026-10-01T12:00:00Z" }, NOW)).toBe(true);
    expect(isNewHunt({ createdAt: "2026-09-21T12:00:00Z" }, NOW)).toBe(true);
    expect(isNewHunt({ createdAt: "2026-09-20T11:59:00Z" }, NOW)).toBe(false);
    expect(isNewHunt({ createdAt: null }, NOW)).toBe(false);
    expect(isNewHunt({ createdAt: "not a date" }, NOW)).toBe(false);
  });
});

describe("applyFilters", () => {
  const hunts = [
    hunt({ id: "a", title: "BYU Sprint", durationMinutes: 20, playMode: "team_random" }),
    hunt({ id: "b", title: "BYU Photo Walk", durationMinutes: 25, challengeTypes: ["photo_observation"] }),
    hunt({ id: "c", title: "Downtown", durationMinutes: 90, createdAt: "2026-10-15T00:00:00Z" }),
  ];

  it("returns everything when no chip (or only Near me) is on", () => {
    expect(applyFilters(hunts, [], NOW)).toHaveLength(3);
    expect(applyFilters(hunts, ["near"], NOW)).toHaveLength(3);
  });

  it("ANDs the selected chips", () => {
    expect(applyFilters(hunts, ["short", "campus"], NOW).map((h) => h.id)).toEqual(["a", "b"]);
    expect(applyFilters(hunts, ["short", "photo"], NOW).map((h) => h.id)).toEqual(["b"]);
    expect(applyFilters(hunts, ["new"], NOW).map((h) => h.id)).toEqual(["c"]);
    expect(applyFilters(hunts, ["team", "photo"], NOW)).toEqual([]);
  });
});

describe("withDistances", () => {
  const origin = { lat: 40.2518, lng: -111.6493 };
  const far = hunt({ id: "far", latitude: 40.3, longitude: -111.7 });
  const near = hunt({ id: "near", latitude: 40.252, longitude: -111.6495 });
  const nowhere = hunt({ id: "nowhere" });

  it("sorts nearest first and leaves hunts without coordinates last", () => {
    const sorted = withDistances([nowhere, far, near], origin, true);
    expect(sorted.map((h) => h.id)).toEqual(["near", "far", "nowhere"]);
    expect(sorted[0].distanceMeters).toBeLessThan(100);
    expect(sorted[2].distanceMeters).toBeNull();
  });

  it("adds distances without reordering when not sorting, and without an origin does nothing", () => {
    expect(withDistances([far, near], origin, false).map((h) => h.id)).toEqual(["far", "near"]);
    const input = [far];
    const out = withDistances(input, null, true);
    expect(out).toEqual(input);
    expect(out).not.toBe(input);
  });
});

describe("toExploreHunt", () => {
  it("counts live stops, collects challenge types and reads the play count", () => {
    const h = toExploreHunt({
      id: "x",
      title: "T",
      cover_image_url: "https://example.supabase.co/storage/v1/object/public/c.jpg",
      subject_domains: ["history_community"],
      finds: [
        { deleted_at: null, tasks: { challenge_type: "photo_observation" } },
        { deleted_at: null, tasks: [{ challenge_type: "multiple_choice" }] },
        { deleted_at: "2026-01-01", tasks: { challenge_type: "team_debate" } },
        { deleted_at: null, tasks: null },
      ],
      play_sessions: [{ count: 12 }],
    });
    expect(h.stopCount).toBe(3);
    expect(h.challengeTypes.sort()).toEqual(["multiple_choice", "photo_observation"]);
    expect(h.plays).toBe(12);
    expect(h.tags).toEqual(["history_community"]);
    expect(h.coverImageUrl).toContain("c.jpg");
  });

  it("tolerates missing embeds", () => {
    const h = toExploreHunt({ id: "y", title: "U" });
    expect(h.stopCount).toBeNull();
    expect(h.challengeTypes).toEqual([]);
    expect(h.plays).toBeNull();
  });
});

describe("popularCampusHunts", () => {
  it("keeps campus hunts only, most played first", () => {
    const list = [
      hunt({ id: "1", title: "BYU A", plays: 3 }),
      hunt({ id: "2", title: "Downtown", plays: 99 }),
      hunt({ id: "3", title: "Campus B", plays: 10 }),
      hunt({ id: "4", title: "BYU C", plays: null }),
    ];
    expect(popularCampusHunts(list).map((h) => h.id)).toEqual(["3", "1", "4"]);
    expect(popularCampusHunts(list, 1).map((h) => h.id)).toEqual(["3"]);
  });
});

describe("audience", () => {
  it("gives hunt authors and staff every age by default", () => {
    for (const role of ["teacher", "hunt_creator", "admin", "researcher"]) {
      expect(defaultAudiencesFor({ role, band: "adult" })).toBeNull();
    }
  });

  it("defaults parents to adults + families, kids and teens to their band + families", () => {
    expect(defaultAudiencesFor({ role: "parent", band: "adult" })).toEqual(["adults", "family"]);
    expect(defaultAudiencesFor({ role: "teen", band: "teen" })).toEqual(["teens", "family"]);
    expect(defaultAudiencesFor({ role: "child", band: "primary" })).toEqual(["kids", "family"]);
    expect(defaultAudiencesFor({ role: "child", band: "intermediate" })).toEqual(["kids", "family"]);
    expect(defaultAudiencesFor({ role: "adult", band: "adult" })).toEqual(["adults"]);
  });

  it("shows signed-out visitors and unknown bands every age", () => {
    expect(defaultAudiencesFor(null)).toBeNull();
    expect(defaultAudiencesFor({ role: "adult", band: null })).toBeNull();
  });

  it("lets the URL override the default with one value, or 'any' for every age", () => {
    const adult = { role: "adult", band: "adult" };
    expect(resolveAudience(undefined, adult)).toEqual({ audiences: ["adults"], explicit: false });
    expect(resolveAudience("family", adult)).toEqual({ audiences: ["family"], explicit: true });
    expect(resolveAudience(["kids", "teens"], adult)).toEqual({ audiences: ["kids"], explicit: true });
    expect(resolveAudience("any", adult)).toEqual({ audiences: null, explicit: true });
    expect(resolveAudience("x),or(", { role: "teen", band: "teen" })).toEqual({
      audiences: ["teens", "family"],
      explicit: false,
    });
    expect(resolveAudience(undefined, { role: "teacher", band: "adult" })).toEqual({ audiences: null, explicit: false });
  });

  it("labels a set of audiences", () => {
    expect(audienceSetLabel(["adults", "family"])).toBe("Adults & families");
    expect(audienceSetLabel(["family", "teens"])).toBe("Teens & families");
    expect(audienceSetLabel(["kids"])).toBe("Kids");
    expect(audienceSetLabel(null)).toBe("All ages");
    expect(audienceSetLabel([])).toBe("All ages");
  });

  it("builds the PostgREST filter only from whitelisted values, always with 'all'", () => {
    expect(audienceOrFilter(["adults"])).toBe("target_audience.in.(adults,all)");
    expect(audienceOrFilter(["family", "adults"])).toBe("target_audience.in.(adults,family,all)");
    expect(audienceOrFilter(null)).toBeNull();
    expect(audienceOrFilter([])).toBeNull();
    expect(audienceOrFilter(["evil),id.eq.(1" as never])).toBeNull();
    expect(audienceOrFilter(["kids", "x)" as never])).toBe("target_audience.in.(kids,all)");
  });
});

describe("exploreHref", () => {
  it("omits defaults", () => {
    expect(exploreHref({})).toBe("/browse");
    expect(exploreHref({ q: "  ", filters: [], view: "list" })).toBe("/browse");
  });

  it("encodes search, chips, audience and view", () => {
    expect(exploreHref({ q: "art & history", filters: ["new", "near"], audience: "any", view: "map" })).toBe(
      "/browse?q=art+%26+history&f=near%2Cnew&audience=any&view=map"
    );
  });
});
