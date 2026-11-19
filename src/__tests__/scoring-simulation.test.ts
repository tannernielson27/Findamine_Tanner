import { describe, it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { calculateScore } from "@/lib/services/scoring";
import { calculateScoreV2 } from "@/lib/services/scoring-v2";
import { compareStanding, boardRanks } from "@/lib/social/standing";
import { v2BreakdownRows, isV2Breakdown, signedPoints } from "@/lib/play/score-breakdown";

/**
 * Evidence for issue #11: how often players share a total under version 1
 * and under version 2. 60 simulated players on a 4-stop hunt, with a fixed
 * seed so the numbers are the same on every run.
 *
 * To print the report (the simulation and the example table), run:
 *   SCORING_REPORT=report.txt npx vitest run src/__tests__/scoring-simulation.test.ts
 */

const PLAYERS = 60;
const STOPS = 4;
const MIN = 60_000;

/** Small seeded generator (mulberry32): the same sequence every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A normal draw (Box-Muller). */
function normal(next: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
}

function pick(next: () => number, weights: number[]): number {
  let r = next();
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) return i;
    r -= weights[i];
  }
  return weights.length - 1;
}

interface StopPlay {
  /** Stop start to the final answer, ms (walking there included). */
  solveMs: number;
  /** Attempts used; 0 means never right in five tries. */
  correctOn: number;
  clueHints: number;
  challengeHints: number;
}

/** One player's hunt: a personal pace and accuracy, then four stops. */
function playHunt(next: () => number): StopPlay[] {
  const pace = Math.exp(0.35 * normal(next));
  const careful = next();
  return Array.from({ length: STOPS }, () => {
    // Median 6 minutes per stop, long right tail; whole seconds plus ms.
    const solveMs = Math.round(6 * MIN * pace * Math.exp(0.55 * normal(next)));
    const firstTry = 0.6 + 0.25 * careful;
    const rest = 1 - firstTry;
    const outcome = pick(next, [firstTry, rest * 0.6, rest * 0.25, rest * 0.15]);
    return {
      solveMs,
      correctOn: outcome === 3 ? 0 : outcome + 1,
      clueHints: pick(next, [0.75, 0.2, 0.05]),
      challengeHints: pick(next, [0.85, 0.15]),
    };
  });
}

function v1Stop(stop: StopPlay, sinceSessionStartMs: number): number {
  const wrong = stop.correctOn === 0;
  return calculateScore({
    isCorrect: !wrong,
    attemptNumber: wrong ? 5 : stop.correctOn,
    hintsUsed: stop.challengeHints,
    clueHintsUsed: stop.clueHints,
    challengeHintsUsed: stop.challengeHints,
    // As the answer route calls version 1: seconds since the session began.
    timeSpentSeconds: Math.round(sinceSessionStartMs / 1000),
    isFirstAttempt: stop.correctOn === 1,
    challengeType: "short_text",
  }).totalScore;
}

function v2Stop(stop: StopPlay): number {
  const wrong = stop.correctOn === 0;
  return calculateScoreV2({
    isCorrect: !wrong,
    attemptNumber: wrong ? 5 : stop.correctOn,
    clueHintsUsed: stop.clueHints,
    challengeHintsUsed: stop.challengeHints,
    startedAt: 0,
    answeredAt: stop.solveMs,
  }).totalScore;
}

interface Totals {
  v1: number;
  v2: number;
  solveMs: number;
  /** Every stop right on the first try with no hints. */
  clean: boolean;
}

/**
 * `allClean`: everyone gets every stop right on the first try with no hints,
 * so only their pace differs (a strong group on an easy hunt).
 */
function simulate(seed: number, opts: { allClean?: boolean } = {}): Totals[] {
  const next = rng(seed);
  return Array.from({ length: PLAYERS }, () => {
    const played = playHunt(next);
    const stops = opts.allClean
      ? played.map((s) => ({ ...s, correctOn: 1, clueHints: 0, challengeHints: 0 }))
      : played;
    let elapsed = 0;
    let v1 = 0;
    let v2 = 0;
    for (const stop of stops) {
      elapsed += stop.solveMs;
      v1 += v1Stop(stop, elapsed);
      v2 += v2Stop(stop);
    }
    const clean = stops.every((s) => s.correctOn === 1 && s.clueHints === 0 && s.challengeHints === 0);
    return { v1, v2, solveMs: elapsed, clean };
  });
}

interface TieStats {
  distinct: number;
  /** Players whose total equals at least one other player's. */
  sharing: number;
  largestGroup: number;
}

function tieStats(totals: number[]): TieStats {
  const groups = new Map<number, number>();
  for (const t of totals) groups.set(t, (groups.get(t) ?? 0) + 1);
  const sizes = [...groups.values()];
  return {
    distinct: sizes.length,
    sharing: sizes.filter((n) => n > 1).reduce((a, b) => a + b, 0),
    largestGroup: Math.max(...sizes),
  };
}

const SEED = 20261118;

describe("scoring simulation: 60 players, 4 stops", () => {
  const players = simulate(SEED);
  const v1 = tieStats(players.map((p) => p.v1));
  const v2 = tieStats(players.map((p) => p.v2));

  // The same 60 paces, but everyone answers every stop right first time, no hints.
  const cleanPlayers = simulate(SEED, { allClean: true });
  const cleanV1 = tieStats(cleanPlayers.map((p) => p.v1));
  const cleanV2 = tieStats(cleanPlayers.map((p) => p.v2));

  it("version 1 leaves at least half the players sharing a total", () => {
    expect(v1.sharing).toBeGreaterThanOrEqual(PLAYERS / 2);
  });

  it("version 1 cannot tell apart players who got everything right; version 2 can", () => {
    expect(cleanPlayers.every((p) => p.clean)).toBe(true);
    // First try, no hints, four stops: 71 each, whatever the pace.
    expect(cleanV1).toEqual({ distinct: 1, sharing: PLAYERS, largestGroup: PLAYERS });
    // Whole-number totals still coincide now and then when everyone plays
    // alike (a few pairs among 60); the tiebreak test below separates those.
    expect(cleanV2.distinct).toBeGreaterThanOrEqual(50);
    expect(cleanV2.sharing).toBeLessThanOrEqual(PLAYERS / 4);
    expect(cleanV2.largestGroup).toBeLessThanOrEqual(3);
  });

  it("the tiebreak separates the all-correct group completely", () => {
    const keys = cleanPlayers
      .map((p) => ({ score: p.v2, solveMs: p.solveMs, completedAt: null }))
      .sort(compareStanding);
    expect(new Set(boardRanks(keys, { splitTies: true })).size).toBe(PLAYERS);
  });

  it("version 2 gives nearly every player their own total", () => {
    expect(v2.distinct).toBeGreaterThanOrEqual(PLAYERS - 6);
    expect(v2.sharing).toBeLessThanOrEqual(12);
    expect(v2.largestGroup).toBeLessThanOrEqual(2);
  });

  it("the tiebreak separates everyone who is left level on score", () => {
    const keys = players
      .map((p) => ({ score: p.v2, solveMs: p.solveMs, completedAt: null }))
      .sort(compareStanding);
    const ranks = boardRanks(keys, { splitTies: true });
    expect(new Set(ranks).size).toBe(PLAYERS);
  });

  it("holds across other seeds, not just the reported one", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = simulate(seed);
      const one = tieStats(run.map((p) => p.v1));
      const two = tieStats(run.map((p) => p.v2));
      expect(two.sharing).toBeLessThan(one.sharing / 3);
      expect(two.largestGroup).toBeLessThanOrEqual(3);
    }
  });

  it("writes the report when asked", () => {
    const line = (name: string, s: TieStats) =>
      `${name}: ${s.distinct} distinct totals among ${PLAYERS} players; ${s.sharing} players share a total with someone; largest tied group ${s.largestGroup}`;
    const example = (label: string, solveMin: number, extra: Partial<Parameters<typeof calculateScoreV2>[0]> = {}) => {
      const r = calculateScoreV2({ isCorrect: true, attemptNumber: 1, startedAt: 0, answeredAt: solveMin * MIN, ...extra });
      const b = r.breakdown;
      return `| ${label} | ${b.correctness} | ${b.firstAttemptBonus} | ${b.completion} | ${b.solveTime} | ${b.hintPenalty ? -b.hintPenalty : 0} | ${r.totalScore} |`;
    };
    const report = [
      `Simulation (seed ${SEED}): ${PLAYERS} players, ${STOPS} stops`,
      line("Version 1", v1),
      line("Version 2", v2),
      "",
      "Same 60 paces, everyone right on the first try with no hints:",
      line("Version 1", cleanV1),
      line("Version 2", cleanV2),
      "",
      "| Case | Answer | First try | Completion | Speed | Hints | Score |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      example("Fast: correct first try in 1 min", 1),
      example("Medium: correct first try in 5 min", 5),
      example("Slow: correct first try in 20 min", 20),
      example("Very slow: correct first try in 60 min or more", 60),
      example("Correct on the second try, 5 min", 5, { attemptNumber: 2 }),
      example("Correct first try with one clue hint, 5 min", 5, { clueHintsUsed: 1 }),
      example("Correct first try with one challenge hint, 5 min", 5, { challengeHintsUsed: 1 }),
      example("Wrong (any time)", 5, { isCorrect: false }),
    ].join("\n");
    if (process.env.SCORING_REPORT) writeFileSync(process.env.SCORING_REPORT, report + "\n", "utf8");
    expect(report).toContain("Version 2");
  });
});

describe("version 2 breakdown rows", () => {
  it("lists each part of the score in plain language, time included, and adds up", () => {
    const r = calculateScoreV2({ isCorrect: true, attemptNumber: 1, clueHintsUsed: 2, startedAt: 0, answeredAt: 5 * MIN });
    const rows = v2BreakdownRows(r.breakdown);
    expect(rows).toEqual([
      { label: "Your answer", points: 500 },
      { label: "Right on the first try", points: 100 },
      { label: "Stop completed", points: 100 },
      { label: "Speed on this stop", points: 191 },
      { label: "Hints used", points: -40 },
    ]);
    expect(rows.reduce((sum, row) => sum + row.points, 0)).toBe(r.totalScore);
  });

  it("shows a wrong answer as zero plus the credit for trying", () => {
    const r = calculateScoreV2({ isCorrect: false, attemptNumber: 1, startedAt: 0, answeredAt: MIN });
    expect(v2BreakdownRows(r.breakdown)).toEqual([
      { label: "Your answer", points: 0 },
      { label: "Speed on this stop", points: 0 },
      { label: "Credit for trying", points: 50 },
    ]);
  });

  it("tells version 2 breakdowns from version 1 ones", () => {
    expect(isV2Breakdown({ correctness: 60, masteryBonus: 8, completion: 3, speed: 0, hintPenalty: 0, effortCredit: 0 })).toBe(false);
    expect(isV2Breakdown(calculateScoreV2({ isCorrect: true, attemptNumber: 1, startedAt: 0, answeredAt: 0 }).breakdown)).toBe(true);
    expect(isV2Breakdown(null)).toBe(false);
    expect(signedPoints(191)).toBe("+191");
    expect(signedPoints(-40)).toBe("−40");
    expect(signedPoints(0)).toBe("0");
  });
});
