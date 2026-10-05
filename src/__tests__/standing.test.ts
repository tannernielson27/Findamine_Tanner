import { describe, it, expect } from "vitest";
import {
  competitionRanks,
  standingAmong,
  summarizeViewerStanding,
  standingCaption,
} from "@/lib/social/standing";

const entries = [
  { user_id: "a", score: 300 },
  { user_id: "b", score: 200 },
  { user_id: "c", score: 150 },
];

const tiedAtTop = [
  { user_id: "a", score: 300 },
  { user_id: "b", score: 300 },
  { user_id: "c", score: 150 },
  { user_id: "d", score: 100 },
];

describe("competitionRanks", () => {
  it("gives tied scores the same rank and skips the next one", () => {
    expect(competitionRanks(tiedAtTop)).toEqual([1, 1, 3, 4]);
    expect(competitionRanks(entries)).toEqual([1, 2, 3]);
    expect(competitionRanks([])).toEqual([]);
  });
});

describe("standingAmong", () => {
  it("ranks a player by how many score strictly higher", () => {
    expect(standingAmong(tiedAtTop, "d")).toEqual({ rank: 4, score: 100, gap_to_next: 50 });
    expect(standingAmong(tiedAtTop, "b")).toEqual({ rank: 1, score: 300, gap_to_next: null });
  });

  it("returns null for a player who isn't ranked", () => {
    expect(standingAmong(tiedAtTop, "nobody")).toBeNull();
  });
});

describe("summarizeViewerStanding", () => {
  it("derives rank + gap from the visible list when the viewer is on it", () => {
    const s = summarizeViewerStanding(entries, "b");
    expect(s.inList).toBe(true);
    expect(s.pinned).toBe(false);
    expect(s.standing).toEqual({ rank: 2, score: 200, gapToNext: 100, nextRank: 1, tied: false });
  });

  it("reports no gap for the leader", () => {
    const s = summarizeViewerStanding(entries, "a");
    expect(s.standing).toEqual({ rank: 1, score: 300, gapToNext: null, tied: false });
  });

  it("prefers the precise server summary (viewer off the visible board)", () => {
    const s = summarizeViewerStanding(entries, "z", { rank: 34, score: 90, gap_to_next: 15 });
    expect(s.inList).toBe(false);
    expect(s.pinned).toBe(true);
    expect(s.standing).toEqual({ rank: 34, score: 90, gapToNext: 15 });
  });

  it("does not pin when the server summary matches a visible viewer", () => {
    const s = summarizeViewerStanding(entries, "c", { rank: 3, score: 150, gap_to_next: 50 });
    expect(s.inList).toBe(true);
    expect(s.pinned).toBe(false);
  });

  it("returns nothing when the viewer is unknown and absent", () => {
    const s = summarizeViewerStanding(entries, null);
    expect(s.standing).toBeNull();
    expect(s.pinned).toBe(false);
  });

  it("gives the second of two tied leaders rank 1, flagged as a tie", () => {
    // Server says rank 1; the row is second in the list. Both must read as #1.
    const s = summarizeViewerStanding(tiedAtTop, "b", { rank: 1, score: 300, gap_to_next: null });
    expect(s.standing).toEqual({ rank: 1, score: 300, gapToNext: null, tied: true });
    expect(standingCaption(s.standing)).toBe("You're tied for the lead!");
  });

  it("describes the row as drawn when the server rank counts players the viewer can't see", () => {
    // A hidden player sits above the viewer server-side (rank 3), but the
    // viewer's row is drawn second, so the caption must say #2's story.
    const s = summarizeViewerStanding(entries, "b", { rank: 3, score: 200, gap_to_next: 40 });
    expect(s.standing?.rank).toBe(2);
    expect(standingCaption(s.standing)).toBe("100 points to reach #1");
  });

  it("aims at the tied group above, not rank - 1", () => {
    const s = summarizeViewerStanding(tiedAtTop, "c");
    expect(s.standing).toEqual({ rank: 3, score: 150, gapToNext: 150, nextRank: 1, tied: false });
    expect(standingCaption(s.standing)).toBe("150 points to reach #1");
  });
});

describe("standingCaption", () => {
  it("celebrates the leader", () => {
    expect(standingCaption({ rank: 1, score: 9, gapToNext: null })).toMatch(/in the lead/i);
  });

  it("nudges toward the next rank with correct pluralization", () => {
    expect(standingCaption({ rank: 5, score: 9, gapToNext: 1 })).toBe("1 point to reach #4");
    expect(standingCaption({ rank: 5, score: 9, gapToNext: 20 })).toBe("20 points to reach #4");
  });

  it("handles ties", () => {
    expect(standingCaption({ rank: 4, score: 9, gapToNext: 0 })).toMatch(/tied/i);
  });

  it("returns empty for no standing", () => {
    expect(standingCaption(null)).toBe("");
  });
});
