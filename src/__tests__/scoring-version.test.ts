import { describe, it, expect } from "vitest";
import {
  HINT_COSTS,
  NEW_HUNT_SCORING_VERSION,
  SCORING_LOCKED_MESSAGE,
  SCORING_VERSION_INVALID_MESSAGE,
  SCORING_VERSION_KEY,
  SOLVE_WINDOW_INVALID_MESSAGE,
  SOLVE_WINDOW_KEY,
  STOP_MAX_SCORE,
  checkScoringEdit,
  inheritScoringSettings,
  readScoringVersion,
  readSolveWindowMinutes,
  readSolveWindowMs,
  scoringSettingsChanged,
  toComparablePoints,
  withNewHuntScoring,
} from "@/lib/hunts/scoring-version";

describe("readScoringVersion", () => {
  it("reads version 1 for hunts that name no version: every hunt made before version 2", () => {
    expect(readScoringVersion(null)).toBe(1);
    expect(readScoringVersion(undefined)).toBe(1);
    expect(readScoringVersion({})).toBe(1);
    expect(readScoringVersion({ scoring_mode: "standard", hide_scores: true })).toBe(1);
  });

  it("reads a stored version", () => {
    expect(readScoringVersion({ scoring_version: 1 })).toBe(1);
    expect(readScoringVersion({ scoring_version: 2 })).toBe(2);
  });

  it("treats anything else as version 1", () => {
    for (const bad of ["2", 3, 0, 2.5, true, null, {}, [2]]) {
      expect(readScoringVersion({ scoring_version: bad })).toBe(1);
    }
  });
});

describe("withNewHuntScoring", () => {
  it("puts new hunts on version 2", () => {
    expect(NEW_HUNT_SCORING_VERSION).toBe(2);
    expect(withNewHuntScoring(null)).toEqual({ scoring_version: 2 });
    expect(withNewHuntScoring({ preset: "practice" })).toEqual({ preset: "practice", scoring_version: 2 });
  });

  it("keeps a valid version the creator asked for and replaces junk", () => {
    expect(withNewHuntScoring({ scoring_version: 1 })).toEqual({ scoring_version: 1 });
    expect(withNewHuntScoring({ scoring_version: 2 })).toEqual({ scoring_version: 2 });
    expect(withNewHuntScoring({ scoring_version: "9" })).toEqual({ scoring_version: 2 });
  });

  it("never changes what it was given", () => {
    const metadata = Object.freeze({ preset: "practice" });
    expect(withNewHuntScoring(metadata)).not.toBe(metadata);
    expect(metadata).toEqual({ preset: "practice" });
  });
});

describe("solve window", () => {
  it("reads a whole number of minutes in range, otherwise nothing", () => {
    expect(readSolveWindowMinutes({ scoring_solve_window_min: 180 })).toBe(180);
    expect(readSolveWindowMs({ scoring_solve_window_min: 20 })).toBe(20 * 60_000);
    for (const bad of [4, 0, -30, 1441, 12.5, "60", null, undefined]) {
      expect(readSolveWindowMinutes({ scoring_solve_window_min: bad })).toBeNull();
      expect(readSolveWindowMs({ scoring_solve_window_min: bad })).toBeNull();
    }
    expect(readSolveWindowMinutes(null)).toBeNull();
  });
});

describe("toComparablePoints", () => {
  it("leaves a version 1 score as it is", () => {
    expect(toComparablePoints(71, 1)).toBe(71);
    expect(toComparablePoints(100, 1)).toBe(100);
    expect(toComparablePoints(5, 1)).toBe(5);
  });

  it("divides a version 2 score by 10, so a stop counts the same on either version", () => {
    expect(STOP_MAX_SCORE).toEqual({ 1: 100, 2: 1000 });
    expect(toComparablePoints(1000, 2)).toBe(100);
    expect(toComparablePoints(891, 2)).toBe(89);
    expect(toComparablePoints(716, 2)).toBe(72);
    expect(toComparablePoints(50, 2)).toBe(5);
    expect(toComparablePoints(3412, 2)).toBe(341);
  });

  it("counts a missing score as nothing", () => {
    expect(toComparablePoints(null, 2)).toBe(0);
    expect(toComparablePoints(undefined, 1)).toBe(0);
    expect(toComparablePoints(Number.NaN, 2)).toBe(0);
  });

  it("knows what a hint costs on each version", () => {
    expect(HINT_COSTS[1]).toEqual({ clue: 2, challenge: 5 });
    expect(HINT_COSTS[2]).toEqual({ clue: 20, challenge: 50 });
  });
});

describe("inheritScoringSettings", () => {
  it("keeps stored scoring settings an update leaves out", () => {
    const before = { scoring_version: 2, scoring_solve_window_min: 90, hide_scores: false };
    expect(inheritScoringSettings(before, { hide_scores: true })).toEqual({
      hide_scores: true,
      scoring_version: 2,
      scoring_solve_window_min: 90,
    });
    expect(inheritScoringSettings(before, null)).toEqual({ scoring_version: 2, scoring_solve_window_min: 90 });
  });

  it("lets an update name its own values, and clear the window with null", () => {
    const before = { scoring_version: 2, scoring_solve_window_min: 90 };
    expect(inheritScoringSettings(before, { scoring_version: 1, scoring_solve_window_min: null })).toEqual({
      scoring_version: 1,
    });
  });

  it("adds nothing to a hunt that never had the settings", () => {
    expect(inheritScoringSettings({ hide_scores: true }, { hide_scores: false })).toEqual({ hide_scores: false });
    expect(inheritScoringSettings(null, null)).toBeNull();
  });

  it("never changes what it was given", () => {
    const before = Object.freeze({ scoring_version: 2 });
    const after = Object.freeze({ hide_scores: true });
    inheritScoringSettings(before, after);
    expect(after).toEqual({ hide_scores: true });
  });
});

describe("checkScoringEdit: scoring can change only while the hunt has no play sessions", () => {
  const v1 = { hide_scores: false };
  const v2 = { scoring_version: 2 };

  it("allows a change before anyone has played", () => {
    expect(checkScoringEdit({ before: v1, after: v2, hasPlaySessions: false })).toEqual({ ok: true });
    expect(checkScoringEdit({ before: v2, after: { scoring_version: 1 }, hasPlaySessions: false })).toEqual({ ok: true });
    expect(
      checkScoringEdit({ before: v2, after: { ...v2, scoring_solve_window_min: 120 }, hasPlaySessions: false })
    ).toEqual({ ok: true });
  });

  it("refuses a version change once the hunt has been played", () => {
    expect(checkScoringEdit({ before: v1, after: v2, hasPlaySessions: true })).toEqual({
      ok: false,
      status: 409,
      error: SCORING_LOCKED_MESSAGE,
    });
    expect(checkScoringEdit({ before: v2, after: { scoring_version: 1 }, hasPlaySessions: true })).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it("refuses a solve-window change once the hunt has been played", () => {
    const after = { ...v2, [SOLVE_WINDOW_KEY]: 120 };
    expect(checkScoringEdit({ before: v2, after, hasPlaySessions: true })).toMatchObject({ ok: false, status: 409 });
  });

  it("lets other settings be saved on a played hunt", () => {
    expect(
      checkScoringEdit({ before: v2, after: { ...v2, hide_scores: true }, hasPlaySessions: true })
    ).toEqual({ ok: true });
    // Writing version 1 on a hunt that is already on version 1 by default changes nothing.
    expect(checkScoringEdit({ before: v1, after: { ...v1, [SCORING_VERSION_KEY]: 1 }, hasPlaySessions: true })).toEqual({
      ok: true,
    });
  });

  it("rejects values that are not a version or a usable window", () => {
    expect(checkScoringEdit({ before: v1, after: { scoring_version: 3 }, hasPlaySessions: false })).toEqual({
      ok: false,
      status: 400,
      error: SCORING_VERSION_INVALID_MESSAGE,
    });
    expect(checkScoringEdit({ before: v2, after: { ...v2, scoring_solve_window_min: 2 }, hasPlaySessions: false })).toEqual({
      ok: false,
      status: 400,
      error: SOLVE_WINDOW_INVALID_MESSAGE,
    });
  });

  it("does not trip over junk that was already stored", () => {
    const junk = { scoring_version: "two" };
    expect(checkScoringEdit({ before: junk, after: { ...junk, hide_scores: true }, hasPlaySessions: true })).toEqual({ ok: true });
  });

  it("reports whether the effective scoring changed", () => {
    expect(scoringSettingsChanged(v1, { scoring_version: 1 })).toBe(false);
    expect(scoringSettingsChanged(v1, v2)).toBe(true);
    expect(scoringSettingsChanged(v2, { ...v2, scoring_solve_window_min: 60 })).toBe(true);
    expect(scoringSettingsChanged(null, undefined)).toBe(false);
  });
});
