import { describe, it, expect } from "vitest";
import {
  REAL_NAMES_PARAM,
  boardRequestPath,
  canViewRealNames,
  otherPlayersNote,
  realNameLabel,
  realNamesRequested,
  resolveRealName,
  withRealNames,
  type RealNameFields,
} from "@/lib/social/real-names";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const CREATOR = "00000000-0000-4000-8000-0000000000c1";
const OTHER = "00000000-0000-4000-8000-0000000000c2";

describe("canViewRealNames", () => {
  it("lets platform admins and researchers see real names on any board", () => {
    for (const role of ["admin", "researcher"]) {
      expect(canViewRealNames({ id: OTHER, role })).toBe(true);
      expect(canViewRealNames({ id: OTHER, role }, CREATOR)).toBe(true);
    }
  });

  it("lets a hunt's creator see them on that hunt only", () => {
    for (const role of ["teacher", "hunt_creator", "adult", "parent"]) {
      expect(canViewRealNames({ id: CREATOR, role }, CREATOR)).toBe(true);
      expect(canViewRealNames({ id: CREATOR, role }, OTHER)).toBe(false);
    }
  });

  it("gives nobody else access, and no creator access on the overall board", () => {
    for (const role of ["child", "teen", "adult", "parent", "teacher", "hunt_creator", "game_master", ""]) {
      expect(canViewRealNames({ id: OTHER, role }, CREATOR)).toBe(false);
      expect(canViewRealNames({ id: CREATOR, role })).toBe(false);
      expect(canViewRealNames({ id: CREATOR, role }, null)).toBe(false);
    }
  });

  it("refuses a signed-out caller", () => {
    expect(canViewRealNames(null)).toBe(false);
    expect(canViewRealNames(null, CREATOR)).toBe(false);
    expect(canViewRealNames(undefined, CREATOR)).toBe(false);
  });
});

describe("realNamesRequested", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("is on only for an explicit real_names=1", () => {
    expect(realNamesRequested(params(`${REAL_NAMES_PARAM}=1`))).toBe(true);
    for (const query of ["", "real_names=", "real_names=0", "real_names=true", "real_names=yes", "realnames=1", "real_names=01"]) {
      expect(realNamesRequested(params(query))).toBe(false);
    }
  });
});

describe("boardRequestPath", () => {
  it("asks for the plain board unless real names are switched on", () => {
    expect(boardRequestPath(undefined, false)).toBe("/api/v1/leaderboard");
    expect(boardRequestPath("h 1", false)).toBe("/api/v1/leaderboard?hunt_id=h%201");
  });

  it("adds the real-names parameter only when asked", () => {
    expect(boardRequestPath(undefined, true)).toBe("/api/v1/leaderboard?real_names=1");
    expect(boardRequestPath("h1", true)).toBe("/api/v1/leaderboard?hunt_id=h1&real_names=1");
    expect(realNamesRequested(new URLSearchParams(boardRequestPath("h1", true).split("?")[1]))).toBe(true);
  });
});

describe("resolveRealName", () => {
  it("returns the name a player saved on their profile, trimmed", () => {
    expect(resolveRealName({ role: "adult", metadata: { real_name: "  Ada Lovelace " } }, NOW)).toEqual({
      real_name: "Ada Lovelace",
      real_name_status: "on_file",
    });
  });

  it("reports no name on file instead of falling back to anything else", () => {
    const none: RealNameFields = { real_name: null, real_name_status: "not_on_file" };
    expect(resolveRealName({ role: "adult", metadata: {} }, NOW)).toEqual(none);
    expect(resolveRealName({ role: "adult", metadata: null }, NOW)).toEqual(none);
    expect(resolveRealName({ role: "adult", metadata: { real_name: "   " } }, NOW)).toEqual(none);
    expect(resolveRealName({ role: "adult", metadata: { real_name: 42 } }, NOW)).toEqual(none);
    expect(resolveRealName({ role: "adult", metadata: "real_name" }, NOW)).toEqual(none);
    expect(resolveRealName(null, NOW)).toEqual(none);
    expect(resolveRealName(undefined, NOW)).toEqual(none);
  });

  it("never returns an email address stored alongside the name", () => {
    const subject = { role: "adult", email: "ada@example.edu", metadata: { email: "ada@example.edu" } };
    expect(JSON.stringify(resolveRealName(subject, NOW))).not.toContain("@");
  });

  it("withholds the real name of child and teen accounts", () => {
    for (const role of ["child", "teen"]) {
      expect(resolveRealName({ role, metadata: { real_name: "Kid Real" } }, NOW)).toEqual({
        real_name: null,
        real_name_status: "withheld_minor",
      });
    }
  });

  it("withholds it for any account whose date of birth is under 18 or unreadable", () => {
    const withheld: RealNameFields = { real_name: null, real_name_status: "withheld_minor" };
    const meta = { real_name: "Young Adult" };
    expect(resolveRealName({ role: "adult", date_of_birth: "2010-06-01", metadata: meta }, NOW)).toEqual(withheld);
    expect(resolveRealName({ role: "adult", date_of_birth: "not-a-date", metadata: meta }, NOW)).toEqual(withheld);
    expect(resolveRealName({ role: "adult", date_of_birth: "2000-06-01", metadata: meta }, NOW).real_name).toBe("Young Adult");
    // Parent, teacher and hunt-creator accounts register without a date of birth.
    expect(resolveRealName({ role: "teacher", date_of_birth: null, metadata: meta }, NOW).real_name).toBe("Young Adult");
  });

  it("says a minor's name is withheld even when none is on file", () => {
    expect(resolveRealName({ role: "child", metadata: {} }, NOW).real_name_status).toBe("withheld_minor");
  });

  it("returns nothing for a deleted account", () => {
    expect(
      resolveRealName({ role: "adult", deleted_at: "2026-11-01T00:00:00Z", metadata: { real_name: "Gone Person" } }, NOW)
    ).toEqual({ real_name: null, real_name_status: "not_on_file" });
  });
});

describe("withRealNames", () => {
  const entries = [
    { user_id: "a", score: 10, display_name: "ada_l" },
    { user_id: "b", score: 5, display_name: "bo" },
  ];
  const names = new Map<string, RealNameFields>([["a", { real_name: "Ada Lovelace", real_name_status: "on_file" }]]);

  it("adds the real-name fields to each row without changing the rest", () => {
    const shownAs = new Map<string, string | null>([["a", "Swift Fox"], ["b", null]]);
    expect(withRealNames(entries, names, shownAs)).toEqual([
      { user_id: "a", score: 10, display_name: "ada_l", real_name: "Ada Lovelace", real_name_status: "on_file", shown_as: "Swift Fox" },
      { user_id: "b", score: 5, display_name: "bo", real_name: null, real_name_status: "not_on_file", shown_as: null },
    ]);
  });

  it("does not mutate the rows it was given", () => {
    const before = JSON.stringify(entries);
    withRealNames(entries, names, new Map());
    expect(JSON.stringify(entries)).toBe(before);
  });
});

describe("otherPlayersNote", () => {
  it("says what other players see when it differs from the row's own name", () => {
    expect(otherPlayersNote("ada_l", "Swift Fox")).toBe("Players see: Swift Fox");
    expect(otherPlayersNote("bo", "Anonymous")).toBe("Players see: Anonymous");
  });

  it("adds nothing when the row already shows that name", () => {
    expect(otherPlayersNote("ada_l", "ada_l")).toBeNull();
    expect(otherPlayersNote("ada_l", undefined)).toBeNull();
  });

  it("says when a player's settings keep them off other players' boards", () => {
    expect(otherPlayersNote("hank", null)).toBe("Hidden from other players' boards");
  });
});

describe("realNameLabel", () => {
  it("shows the name, or says plainly why there isn't one", () => {
    expect(realNameLabel({ real_name: "Ada Lovelace", real_name_status: "on_file" })).toBe("Ada Lovelace");
    expect(realNameLabel({ real_name: null, real_name_status: "not_on_file" })).toBe("No real name on file");
    expect(realNameLabel({ real_name: null, real_name_status: "withheld_minor" })).toBe("Withheld (under 18)");
  });

  it("treats a row with no real-name fields as having none on file", () => {
    expect(realNameLabel({})).toBe("No real name on file");
    expect(realNameLabel({ real_name: "", real_name_status: "on_file" })).toBe("No real name on file");
  });
});
