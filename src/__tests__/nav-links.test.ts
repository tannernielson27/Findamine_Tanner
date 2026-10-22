import { describe, it, expect } from "vitest";
import {
  activeTabHref,
  navLinksFor,
  PLAYER_ROLES,
  profileLinksFor,
  shellChromeFor,
  showPrivacyNavLink,
  showPrivacyProfileRow,
  tabsFor,
  type PrivacyFriction,
} from "@/components/layout/nav-links";
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

const tabHrefs = (role: string) => tabsFor({ role }).map((t) => t.href);
const ALL_ROLES = ["child", "teen", "adult", "parent", "teacher", "hunt_creator", "admin", "researcher"];

describe("tabsFor (bottom tab bar)", () => {
  it("returns nothing when signed out", () => {
    expect(tabsFor(null)).toEqual([]);
    expect(tabsFor(undefined)).toEqual([]);
  });

  it("gives players Home · Explore · Ranks · Profile", () => {
    for (const role of ["child", "teen", "adult", "parent"]) {
      expect(tabHrefs(role)).toEqual(["/dashboard", "/browse", "/leaderboard", "/dashboard/profile"]);
      expect(tabsFor({ role }).map((t) => t.label)).toEqual(["Home", "Explore", "Ranks", "Profile"]);
    }
  });

  it("gives creators, teachers, admins and researchers My Hunts instead of Ranks", () => {
    for (const role of ["teacher", "hunt_creator", "admin", "researcher"]) {
      expect(tabHrefs(role)).toEqual(["/dashboard", "/browse", "/dashboard/hunts", "/dashboard/profile"]);
    }
  });

  it("never makes Create, Rosters, Admin or Privacy a tab", () => {
    for (const role of ALL_ROLES) {
      const tabs = tabHrefs(role);
      expect(tabs).not.toContain("/dashboard/hunts/new");
      expect(tabs).not.toContain("/dashboard/rosters");
      expect(tabs).not.toContain("/admin");
      expect(tabs).not.toContain("/settings/privacy");
      expect(tabs.length).toBeLessThanOrEqual(5);
    }
  });

  it("gives an unknown role the universal tabs only", () => {
    expect(tabHrefs("mystery")).toEqual(["/dashboard", "/browse", "/dashboard/profile"]);
  });
});

describe("activeTabHref", () => {
  const player = tabsFor({ role: "adult" });
  const creator = tabsFor({ role: "teacher" });

  it("lights Home only on /dashboard itself", () => {
    expect(activeTabHref(player, "/dashboard")).toBe("/dashboard");
    expect(activeTabHref(player, "/dashboard/whatever")).toBeNull();
  });

  it("lights Explore on the catalogue and its sub-pages", () => {
    expect(activeTabHref(player, "/browse")).toBe("/browse");
    expect(activeTabHref(player, "/browse/standards")).toBe("/browse");
  });

  it("lights Ranks for players and nothing for creators on /leaderboard", () => {
    expect(activeTabHref(player, "/leaderboard")).toBe("/leaderboard");
    expect(activeTabHref(creator, "/leaderboard")).toBeNull();
  });

  it("lights My Hunts on the creator pages, including create", () => {
    expect(activeTabHref(creator, "/dashboard/hunts")).toBe("/dashboard/hunts");
    expect(activeTabHref(creator, "/dashboard/hunts/new")).toBe("/dashboard/hunts");
    expect(activeTabHref(player, "/dashboard/hunts")).toBeNull();
  });

  it("lights Profile on everything reached from Profile", () => {
    for (const path of ["/dashboard/profile", "/settings", "/settings/privacy", "/dashboard/badges", "/dashboard/social", "/dashboard/teams", "/admin/research", "/profile/abc"]) {
      expect(activeTabHref(player, path)).toBe("/dashboard/profile");
    }
  });

  it("does not match lookalike prefixes", () => {
    expect(activeTabHref(player, "/browser")).toBeNull();
    expect(activeTabHref(player, "/settingsx")).toBeNull();
  });
});

describe("shellChromeFor", () => {
  it("hides all chrome during play and on hunt detail", () => {
    for (const path of ["/play/123", "/play", "/browse/8f2c"]) {
      expect(shellChromeFor(path)).toEqual({ topBar: false, tabBar: false, miniBar: false });
    }
  });

  it("keeps the tab bar on the catalogue and the standards listing", () => {
    expect(shellChromeFor("/browse").tabBar).toBe(true);
    expect(shellChromeFor("/browse/standards").tabBar).toBe(true);
  });

  it("allows the mini-bar on tab screens except Home", () => {
    expect(shellChromeFor("/dashboard")).toEqual({ topBar: true, tabBar: true, miniBar: false });
    for (const path of ["/browse", "/leaderboard", "/dashboard/profile", "/dashboard/hunts", "/settings"]) {
      expect(shellChromeFor(path)).toEqual({ topBar: true, tabBar: true, miniBar: true });
    }
  });

  it("keeps only the top bar on admin, surveys and the debrief", () => {
    for (const path of ["/admin", "/admin/surveys/1", "/surveys", "/surveys/abc", "/debrief"]) {
      expect(shellChromeFor(path)).toEqual({ topBar: true, tabBar: false, miniBar: false });
    }
  });
});

describe("showPrivacyProfileRow (privacy_friction manipulation in the Profile tab)", () => {
  const withdrawn = { [WITHDRAWN_META_KEY]: "2026-10-01T00:00:00Z", privacy_friction: "high" };
  const cases: Array<[PrivacyFriction | string, Record<string, unknown> | null | undefined]> = [
    ["high", undefined],
    ["high", null],
    ["high", { privacy_friction: "high" }],
    ["high", withdrawn],
    ["low", undefined],
    ["low", withdrawn],
    [null, undefined],
    [undefined, undefined],
    ["", undefined],
    ["HIGH", undefined],
    ["medium", null],
  ];

  it("follows showPrivacyNavLink exactly, for every friction/metadata combination", () => {
    for (const [friction, metadata] of cases) {
      expect(showPrivacyProfileRow({ privacy_friction: friction as PrivacyFriction, metadata })).toBe(
        showPrivacyNavLink(friction, metadata)
      );
    }
  });

  it("hides the row only for explicit high friction", () => {
    expect(showPrivacyProfileRow({ privacy_friction: "high" })).toBe(false);
    expect(showPrivacyProfileRow({ privacy_friction: "low" })).toBe(true);
    expect(showPrivacyProfileRow({ privacy_friction: null })).toBe(true);
    expect(showPrivacyProfileRow({})).toBe(true);
  });

  it("shows the row to a withdrawn participant even with high on record", () => {
    expect(showPrivacyProfileRow({ privacy_friction: "high", metadata: withdrawn })).toBe(true);
  });

  it("matches whether the old navbar put Privacy in the main nav, for every role", () => {
    for (const role of ALL_ROLES) {
      for (const friction of ["low", "high", null, undefined] as const) {
        expect(showPrivacyProfileRow({ privacy_friction: friction })).toBe(hrefs(role, friction).includes("/settings/privacy"));
      }
    }
  });

  it("is off for a signed-out visitor", () => {
    expect(showPrivacyProfileRow(null)).toBe(false);
  });
});

describe("profileLinksFor (Profile tab settings list)", () => {
  const links = (role: string) => profileLinksFor(role).map((l) => l.href);

  it("lists Privacy settings for everyone except high friction, who keep Settings → More", () => {
    const privacyFor = (role: string, user: Parameters<typeof profileLinksFor>[1]) =>
      profileLinksFor(role, user).map((l) => l.href).includes("/settings/privacy");
    for (const role of [...ALL_ROLES, "mystery"]) {
      expect(links(role)).toContain("/settings");
      expect(privacyFor(role, { privacy_friction: "low" })).toBe(true);
      expect(privacyFor(role, { privacy_friction: null })).toBe(true);
      expect(privacyFor(role, {})).toBe(true);
      expect(privacyFor(role, { privacy_friction: "high" })).toBe(false);
      expect(privacyFor(role, { privacy_friction: "high", metadata: { [WITHDRAWN_META_KEY]: "2026-10-01T00:00:00Z" } })).toBe(true);
    }
  });

  it("puts Privacy settings right after Settings", () => {
    const hrefList = profileLinksFor("adult", { privacy_friction: "low" }).map((l) => l.href);
    expect(hrefList.indexOf("/settings/privacy")).toBe(hrefList.indexOf("/settings") + 1);
  });

  it("omits the Privacy row when no user context is given", () => {
    expect(links("adult")).not.toContain("/settings/privacy");
  });

  it("keeps every old hamburger destination reachable", () => {
    for (const role of ALL_ROLES) {
      expect(links(role)).toEqual(expect.arrayContaining(["/settings", "/privacy", "/terms", "/dashboard/social", "/dashboard/teams"]));
    }
  });

  it("shows Rosters to roster roles and Admin to admin roles only", () => {
    expect(links("teacher")).toContain("/dashboard/rosters");
    expect(links("admin")).toContain("/dashboard/rosters");
    expect(links("hunt_creator")).not.toContain("/dashboard/rosters");
    expect(links("adult")).not.toContain("/dashboard/rosters");
    expect(links("admin")).toContain("/admin");
    expect(links("researcher")).toContain("/admin");
    expect(links("teacher")).not.toContain("/admin");
    expect(links("adult")).not.toContain("/admin");
  });

  it("covers every non-privacy link the old navbar offered, via tabs, Profile or the + in My Hunts", () => {
    for (const role of ALL_ROLES) {
      const createInMyHunts = tabHrefs(role).includes("/dashboard/hunts") ? ["/dashboard/hunts/new"] : [];
      const reachable = new Set([...tabHrefs(role), ...links(role), ...createInMyHunts]);
      for (const old of hrefs(role, "high")) {
        expect(reachable.has(old)).toBe(true);
      }
    }
  });

  it("keeps the leaderboard a tab for players", () => {
    for (const role of PLAYER_ROLES) expect(tabHrefs(role)).toContain("/leaderboard");
  });
});
