import { describe, it, expect } from "vitest";
import {
  boardRanks,
  compareStanding,
  displayRanks,
  standingCaption,
  summarizeViewerStanding,
  type StandingKey,
} from "@/lib/social/standing";

const key = (score: number, solveMs: number | null, completedAt: string | null = null): StandingKey => ({
  score,
  solveMs,
  completedAt,
});

describe("compareStanding: score, then solve time, then finish time", () => {
  it("puts the higher score first whatever the times", () => {
    expect(compareStanding(key(900, 9_000_000), key(899, 1))).toBeLessThan(0);
  });

  it("breaks equal scores on the lower total solve time", () => {
    expect(compareStanding(key(900, 600_000), key(900, 600_001))).toBeLessThan(0);
    expect(compareStanding(key(900, 700_000), key(900, 600_000))).toBeGreaterThan(0);
  });

  it("breaks equal score and solve time on the earlier finish", () => {
    const early = key(900, 600_000, "2026-11-18T10:00:00.000Z");
    const late = key(900, 600_000, "2026-11-18T10:00:01.000Z");
    expect(compareStanding(early, late)).toBeLessThan(0);
    expect(compareStanding(early, { ...early })).toBe(0);
  });

  it("sorts an unknown solve time or finish after a known one", () => {
    expect(compareStanding(key(900, null), key(900, 5_000_000))).toBeGreaterThan(0);
    expect(compareStanding(key(900, 1, null), key(900, 1, "2026-11-18T10:00:00.000Z"))).toBeGreaterThan(0);
    expect(compareStanding(key(900, null), key(900, null))).toBe(0);
  });
});

describe("boardRanks", () => {
  const rows = [key(900, 1), key(800, 5), key(800, 9), key(800, 9), key(700, null)];

  it("splits equal scores when the tiebreak separates them", () => {
    expect(boardRanks(rows, { splitTies: true })).toEqual([1, 2, 3, 3, 5]);
  });

  it("shares a rank on equal scores when ties are not split", () => {
    expect(boardRanks(rows, { splitTies: false })).toEqual([1, 2, 2, 2, 5]);
    expect(boardRanks([], { splitTies: true })).toEqual([]);
  });
});

describe("a board that carries server ranks", () => {
  const entries = [
    { user_id: "a", score: 900, rank: 1 },
    { user_id: "b", score: 800, rank: 2 },
    { user_id: "c", score: 800, rank: 3 },
  ];

  it("draws the server's ranks, and falls back to score ranks when any is missing", () => {
    expect(displayRanks(entries)).toEqual([1, 2, 3]);
    expect(displayRanks([{ user_id: "a", score: 5 }, { user_id: "b", score: 5, rank: 2 }])).toEqual([1, 1]);
  });

  it("tells a player level on score that the one above was faster", () => {
    const { standing } = summarizeViewerStanding(entries, "c");
    expect(standing).toEqual({ rank: 3, score: 800, gapToNext: 0, nextRank: 2, tied: false });
    expect(standingCaption(standing)).toBe("Same score as #2. Their solve time was faster.");
  });

  it("uses the same caption for a viewer pinned below the visible rows", () => {
    const { standing } = summarizeViewerStanding(entries, "z", { rank: 40, score: 500, gap_to_next: 0, tied: false });
    expect(standingCaption(standing)).toBe("Same score as #39. Their solve time was faster.");
  });
});
