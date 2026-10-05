import { describe, it, expect } from "vitest";
import { navLinksFor, showPrivacyNavLink } from "@/components/layout/nav-links";
import { WITHDRAWN_META_KEY } from "@/lib/utils/conditions";

const hrefs = (role: string, friction?: "low" | "high" | null) =>
  navLinksFor({ role, privacy_friction: friction }).map((l) => l.href);

describe("showPrivacyNavLink (privacy_friction manipulation)", () => {
  it("hides the link only for an explicit high-friction assignment", () => {
    expect(showPrivacyNavLink("high")).toBe(false);
  });

  it("shows the link for low friction", () => {
    expect(showPrivacyNavLink("low")).toBe(true);
  });

  it("shows the link when friction is not a linked factor (null / undefined)", () => {
    expect(showPrivacyNavLink(null)).toBe(true);
    expect(showPrivacyNavLink(undefined)).toBe(true);
  });

  it("shows the link for unrecognized values rather than treating them as high", () => {
    expect(showPrivacyNavLink("")).toBe(true);
    expect(showPrivacyNavLink("HIGH")).toBe(true);
    expect(showPrivacyNavLink("medium")).toBe(true);
  });

  it("never manipulates a withdrawn participant, even with high on record", () => {
    const withdrawn = { [WITHDRAWN_META_KEY]: "2026-10-01T00:00:00Z", privacy_friction: "high" };
    expect(showPrivacyNavLink("high", withdrawn)).toBe(true);
    expect(showPrivacyNavLink("high", { privacy_friction: "high" })).toBe(false);
    expect(showPrivacyNavLink("high", null)).toBe(false);
  });
});

describe("navLinksFor", () => {
  it("returns nothing when signed out", () => {
    expect(navLinksFor(null)).toEqual([]);
  });

  it("puts Privacy in the nav for every role unless friction is high", () => {
    for (const role of ["child", "teen", "adult", "parent", "teacher", "hunt_creator", "admin", "researcher"]) {
      expect(hrefs(role, null)).toContain("/settings/privacy");
      expect(hrefs(role, undefined)).toContain("/settings/privacy");
      expect(hrefs(role, "low")).toContain("/settings/privacy");
      expect(hrefs(role, "high")).not.toContain("/settings/privacy");
    }
  });

  it("shows Rosters only to the roles the roster API accepts", () => {
    expect(hrefs("teacher")).toContain("/dashboard/rosters");
    expect(hrefs("admin")).toContain("/dashboard/rosters");
    for (const role of ["hunt_creator", "researcher", "child", "teen", "adult", "parent"]) {
      expect(hrefs(role)).not.toContain("/dashboard/rosters");
    }
  });

  it("shows Create to hunt-authoring roles only", () => {
    for (const role of ["teacher", "hunt_creator", "admin", "researcher"]) {
      expect(hrefs(role)).toContain("/dashboard/hunts/new");
    }
    for (const role of ["child", "teen", "adult", "parent"]) {
      expect(hrefs(role)).not.toContain("/dashboard/hunts/new");
    }
  });

  it("shows Admin to admin and researcher only", () => {
    expect(hrefs("admin")).toContain("/admin");
    expect(hrefs("researcher")).toContain("/admin");
    for (const role of ["child", "teen", "adult", "parent", "teacher", "hunt_creator"]) {
      expect(hrefs(role)).not.toContain("/admin");
    }
  });

  it("links the leaderboard for player roles", () => {
    for (const role of ["child", "teen", "adult", "parent"]) {
      expect(hrefs(role)).toContain("/leaderboard");
    }
    for (const role of ["teacher", "hunt_creator", "admin", "researcher"]) {
      expect(hrefs(role)).not.toContain("/leaderboard");
    }
  });

  it("gives a study participant (adult, friction unlinked) the expected nav", () => {
    expect(hrefs("adult", null)).toEqual(["/dashboard", "/browse", "/leaderboard", "/settings/privacy"]);
  });

  it("gives an unknown role only the universal links", () => {
    expect(hrefs("mystery")).toEqual(["/dashboard", "/browse", "/settings/privacy"]);
  });
});
