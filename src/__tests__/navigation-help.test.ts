import { describe, it, expect } from "vitest";
import {
  NAVIGATION_HELP_KEY,
  NAVIGATION_HELP_LABELS,
  NAVIGATION_HELP_LEVELS,
  NAVIGATION_HELP_LOCKED_MESSAGE,
  checkNavigationHelpEdit,
  inheritNavigationHelp,
  isNavigationHelp,
  navigationAids,
  navigationHelpChanged,
  readNavigationHelp,
  sessionNavigationHelpMetadata,
  withNavigationHelp,
  withoutArrivalDistance,
} from "@/lib/play/navigation-help";

/** Issue #15: how much navigation help a hunt gives ("Difficulty" in the UI). */

describe("readNavigationHelp", () => {
  it("a hunt with no setting is Easy, so existing hunts keep today's behaviour", () => {
    expect(readNavigationHelp(null)).toBe("easy");
    expect(readNavigationHelp(undefined)).toBe("easy");
    expect(readNavigationHelp({})).toBe("easy");
    expect(readNavigationHelp({ clue_delivery: "random_order" })).toBe("easy");
  });

  it("reads the three levels", () => {
    for (const level of NAVIGATION_HELP_LEVELS) {
      expect(readNavigationHelp({ [NAVIGATION_HELP_KEY]: level })).toBe(level);
    }
  });

  it("treats junk as Easy", () => {
    for (const junk of ["HARD", "impossible", 2, true, null, ["hard"], { level: "hard" }]) {
      expect(readNavigationHelp({ [NAVIGATION_HELP_KEY]: junk })).toBe("easy");
      expect(isNavigationHelp(junk)).toBe(false);
    }
  });
});

describe("navigationAids", () => {
  it("Easy: map and meter. Medium: meter only. Hard: neither", () => {
    expect(navigationAids("easy")).toEqual({ map: true, meter: true });
    expect(navigationAids("medium")).toEqual({ map: false, meter: true });
    expect(navigationAids("hard")).toEqual({ map: false, meter: false });
  });
});

describe("withNavigationHelp", () => {
  it("sets the level without touching other settings or the input", () => {
    const before = { clue_delivery: "fixed_order", hide_scores: true };
    const after = withNavigationHelp(before, "hard");
    expect(after).toEqual({ clue_delivery: "fixed_order", hide_scores: true, navigation_help: "hard" });
    expect(before).toEqual({ clue_delivery: "fixed_order", hide_scores: true });
    expect(withNavigationHelp(null, "medium")).toEqual({ navigation_help: "medium" });
  });
});

describe("inheritNavigationHelp", () => {
  it("a save that leaves the level out keeps the stored one", () => {
    expect(inheritNavigationHelp({ navigation_help: "hard" }, { hide_scores: true })).toEqual({
      hide_scores: true,
      navigation_help: "hard",
    });
    expect(inheritNavigationHelp({ navigation_help: "medium" }, null)).toEqual({ navigation_help: "medium" });
  });

  it("leaves the update alone when it names a level or nothing is stored", () => {
    const explicit = { navigation_help: "easy" };
    expect(inheritNavigationHelp({ navigation_help: "hard" }, explicit)).toBe(explicit);
    const plain = { hide_scores: true };
    expect(inheritNavigationHelp({}, plain)).toBe(plain);
    expect(inheritNavigationHelp(null, null)).toBeNull();
  });
});

describe("checkNavigationHelpEdit", () => {
  it("allows any valid level before the hunt is locked", () => {
    for (const level of NAVIGATION_HELP_LEVELS) {
      expect(checkNavigationHelpEdit({ locked: false, before: {}, after: { navigation_help: level } })).toEqual({ ok: true });
    }
  });

  it("rejects an unknown level whether or not the hunt is locked", () => {
    for (const locked of [false, true]) {
      const result = checkNavigationHelpEdit({ locked, before: {}, after: { navigation_help: "extreme" } });
      expect(result).toMatchObject({ ok: false, status: 400 });
    }
  });

  it("rejects a change once the hunt is locked, and says to clone", () => {
    const result = checkNavigationHelpEdit({ locked: true, before: { navigation_help: "medium" }, after: { navigation_help: "hard" } });
    expect(result).toEqual({ ok: false, status: 409, error: NAVIGATION_HELP_LOCKED_MESSAGE });
    expect(NAVIGATION_HELP_LOCKED_MESSAGE).toMatch(/Clone/);
  });

  it("a locked hunt can still be saved with the same level, spelled out or not", () => {
    expect(checkNavigationHelpEdit({ locked: true, before: {}, after: { navigation_help: "easy" } })).toEqual({ ok: true });
    expect(checkNavigationHelpEdit({ locked: true, before: { navigation_help: "hard" }, after: { navigation_help: "hard", hide_scores: true } })).toEqual({ ok: true });
  });

  it("navigationHelpChanged compares the effective level", () => {
    expect(navigationHelpChanged({}, { navigation_help: "easy" })).toBe(false);
    expect(navigationHelpChanged({ navigation_help: "junk" }, null)).toBe(false);
    expect(navigationHelpChanged({ navigation_help: "medium" }, {})).toBe(true);
  });
});

describe("telemetry", () => {
  it("records the level on the play session", () => {
    expect(sessionNavigationHelpMetadata("medium")).toEqual({ navigation_help: "medium" });
  });

  it("names every level for the UI", () => {
    expect(NAVIGATION_HELP_LABELS).toEqual({ easy: "Easy", medium: "Medium", hard: "Hard" });
  });
});

describe("withoutArrivalDistance", () => {
  const rows = [
    { find_id: "f0", metadata: { arrival_distance: 12.4, arrival_method: "gps_tap", prime_viewed_at: "t" } },
    { find_id: "f1", metadata: null },
    { find_id: "f2" },
  ];

  it("Hard: drops how far from the stop the player was when they checked in", () => {
    const out = withoutArrivalDistance(rows, "hard");
    expect(JSON.stringify(out)).not.toContain("arrival_distance");
    expect(out[0]).toEqual({ find_id: "f0", metadata: { arrival_method: "gps_tap", prime_viewed_at: "t" } });
    expect(out[1]).toEqual(rows[1]);
    // Never mutates what it was given.
    expect(rows[0].metadata).toHaveProperty("arrival_distance", 12.4);
  });

  it("Easy and Medium: untouched", () => {
    expect(withoutArrivalDistance(rows, "easy")).toBe(rows);
    expect(withoutArrivalDistance(rows, "medium")).toBe(rows);
  });
});
