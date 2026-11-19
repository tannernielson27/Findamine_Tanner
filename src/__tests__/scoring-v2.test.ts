import { describe, it, expect } from "vitest";
import { calculateScore, type ScoringInput } from "@/lib/services/scoring";
import {
  calculateScoreV2,
  timeLayerShare,
  SCORING_V2,
  type ScoringV2Input,
} from "@/lib/services/scoring-v2";

const MIN = 60_000;
const HOUR = 60 * MIN;
const START = Date.parse("2026-11-18T15:00:00.000Z");

/** A correct first attempt, no hints, answered `solveMs` after the stop's start. */
function answer(solveMs: number, extra: Partial<ScoringV2Input> = {}): ScoringV2Input {
  return {
    isCorrect: true,
    attemptNumber: 1,
    startedAt: START,
    answeredAt: START + solveMs,
    ...extra,
  };
}

function sum(b: ReturnType<typeof calculateScoreV2>["breakdown"]): number {
  return b.correctness + b.firstAttemptBonus + b.completion + b.solveTime + b.releaseTime - b.hintPenalty + b.effortCredit;
}

describe("timeLayerShare", () => {
  it("is 1 at zero and 0 from the window on", () => {
    expect(timeLayerShare(0, 2 * MIN, 60 * MIN)).toBe(1);
    expect(timeLayerShare(60 * MIN, 2 * MIN, 60 * MIN)).toBeCloseTo(0, 12);
    expect(timeLayerShare(61 * MIN, 2 * MIN, 60 * MIN)).toBe(0);
    expect(timeLayerShare(10 * HOUR, 2 * MIN, 60 * MIN)).toBe(0);
  });

  it("follows 1 - ln(1 + t/tau) / ln(1 + T/tau)", () => {
    const share = (tMin: number) => timeLayerShare(tMin * MIN, 2 * MIN, 60 * MIN);
    expect(share(2)).toBeCloseTo(1 - Math.log(2) / Math.log(31), 12);
    expect(share(10)).toBeCloseTo(1 - Math.log(6) / Math.log(31), 12);
  });

  it("matches the release-layer checkpoints written in the issue", () => {
    const share = (ms: number) => timeLayerShare(ms, 10 * MIN, 24 * HOUR);
    expect(share(10 * MIN)).toBeCloseTo(0.86, 2);
    expect(share(1 * HOUR)).toBeCloseTo(0.61, 2);
    expect(share(6 * HOUR)).toBeCloseTo(0.27, 2);
    expect(share(24 * HOUR)).toBeCloseTo(0, 12);
    expect(share(48 * HOUR)).toBe(0);
  });

  it("falls steeply at first and flattens later", () => {
    const share = (tMin: number) => timeLayerShare(tMin * MIN, 2 * MIN, 60 * MIN);
    const firstFive = share(0) - share(5);
    const lastFive = share(55) - share(60);
    expect(firstFive).toBeGreaterThan(lastFive * 10);
    // Never goes back up.
    for (let t = 1; t <= 70; t++) expect(share(t)).toBeLessThanOrEqual(share(t - 1));
  });

  it("clamps: a negative time counts as zero, an unknown one earns nothing", () => {
    expect(timeLayerShare(-5 * MIN, 2 * MIN, 60 * MIN)).toBe(1);
    expect(timeLayerShare(null, 2 * MIN, 60 * MIN)).toBe(0);
    expect(timeLayerShare(Number.NaN, 2 * MIN, 60 * MIN)).toBe(0);
    expect(timeLayerShare(Number.POSITIVE_INFINITY, 2 * MIN, 60 * MIN)).toBe(0);
    expect(timeLayerShare(MIN, 0, 60 * MIN)).toBe(0);
  });
});

describe("calculateScoreV2: components", () => {
  it("adds up to 1000 for an instant, correct, first-attempt answer", () => {
    const r = calculateScoreV2(answer(0));
    expect(r.version).toBe(2);
    expect(r.totalScore).toBe(1000);
    expect(r.breakdown).toEqual({
      correctness: 500,
      firstAttemptBonus: 100,
      completion: 100,
      solveTime: 300,
      releaseTime: 0,
      hintPenalty: 0,
      effortCredit: 0,
    });
    const { correctnessPoints, firstAttemptBonus, completionPoints, timePoints, maxScore } = SCORING_V2;
    expect(correctnessPoints + firstAttemptBonus + completionPoints + timePoints).toBe(maxScore);
  });

  it("always returns a whole number whose breakdown adds up to it", () => {
    for (const solveMs of [0, 1, 999, 37_512, 5 * MIN + 123, 59 * MIN, 3 * HOUR]) {
      for (const attemptNumber of [1, 2, 5]) {
        for (const isCorrect of [true, false]) {
          const r = calculateScoreV2(answer(solveMs, { attemptNumber, isCorrect, clueHintsUsed: 1 }));
          expect(Number.isInteger(r.totalScore)).toBe(true);
          expect(sum(r.breakdown)).toBe(r.totalScore);
          expect(r.totalScore).toBeGreaterThanOrEqual(SCORING_V2.minScore);
          expect(r.totalScore).toBeLessThanOrEqual(SCORING_V2.maxScore);
        }
      }
    }
  });

  it("scores the example table", () => {
    expect(calculateScoreV2(answer(1 * MIN)).totalScore).toBe(965);
    expect(calculateScoreV2(answer(5 * MIN)).totalScore).toBe(891);
    expect(calculateScoreV2(answer(20 * MIN)).totalScore).toBe(791);
    expect(calculateScoreV2(answer(5 * MIN, { attemptNumber: 2 })).totalScore).toBe(716);
    expect(calculateScoreV2(answer(5 * MIN, { clueHintsUsed: 1 })).totalScore).toBe(871);
    expect(calculateScoreV2(answer(5 * MIN, { challengeHintsUsed: 1 })).totalScore).toBe(841);
    expect(calculateScoreV2(answer(5 * MIN, { isCorrect: false })).totalScore).toBe(50);
  });

  it("takes 15% off correctness per retry, down to 40%", () => {
    const correctness = (attemptNumber: number) =>
      calculateScoreV2(answer(MIN, { attemptNumber })).breakdown.correctness;
    expect(correctness(1)).toBe(500);
    expect(correctness(2)).toBe(425);
    expect(correctness(3)).toBe(350);
    expect(correctness(4)).toBe(275);
    expect(correctness(5)).toBe(200);
    expect(correctness(6)).toBe(200);
    expect(correctness(40)).toBe(200);
  });

  it("gives the first-attempt bonus on the first attempt only", () => {
    expect(calculateScoreV2(answer(MIN)).breakdown.firstAttemptBonus).toBe(100);
    expect(calculateScoreV2(answer(MIN, { attemptNumber: 2 })).breakdown.firstAttemptBonus).toBe(0);
    expect(calculateScoreV2(answer(MIN, { isCorrect: false })).breakdown.firstAttemptBonus).toBe(0);
  });

  it("charges 20 per clue hint and 50 per challenge hint", () => {
    const r = calculateScoreV2(answer(MIN, { clueHintsUsed: 2, challengeHintsUsed: 1 }));
    expect(r.breakdown.hintPenalty).toBe(2 * 20 + 1 * 50);
    expect(calculateScoreV2(answer(MIN)).totalScore - r.totalScore).toBe(90);
  });

  it("ignores negative, fractional and non-numeric hint counts", () => {
    const clean = calculateScoreV2(answer(MIN));
    const bad = calculateScoreV2(answer(MIN, { clueHintsUsed: -100, challengeHintsUsed: Number.NaN }));
    expect(bad.totalScore).toBe(clean.totalScore);
    expect(bad.breakdown.hintPenalty).toBe(0);
    expect(calculateScoreV2(answer(MIN, { clueHintsUsed: 1.9 })).breakdown.hintPenalty).toBe(20);
  });

  it("scores a wrong answer at the floor, with no time points however fast", () => {
    const r = calculateScoreV2(answer(1000, { isCorrect: false }));
    expect(r.totalScore).toBe(50);
    expect(r.breakdown.solveTime).toBe(0);
    expect(r.breakdown.releaseTime).toBe(0);
    expect(r.breakdown.completion).toBe(0);
    expect(r.breakdown.effortCredit).toBe(50);
    expect(r.feedback).toEqual({ type: "incorrect", attemptNumber: 1, canRetry: true });
    // The time is still recorded for research.
    expect(r.timing.solveMs).toBe(1000);
  });

  it("never lets a wrong answer outscore a correct one", () => {
    const worstCorrect = calculateScoreV2(
      answer(5 * HOUR, { attemptNumber: 5, clueHintsUsed: 3, challengeHintsUsed: 3 })
    );
    const bestWrong = calculateScoreV2(answer(0, { isCorrect: false }));
    expect(worstCorrect.totalScore).toBeGreaterThanOrEqual(bestWrong.totalScore);
  });

  it("gives partial credit its share of the correctness points, and no time", () => {
    const r = calculateScoreV2(answer(MIN, { isCorrect: false, partialCredit: 0.5 }));
    expect(r.breakdown.correctness).toBe(250);
    expect(r.breakdown.solveTime).toBe(0);
    expect(r.totalScore).toBe(250);
    expect(r.feedback.type).toBe("partial");
    // Out-of-range credit is clamped.
    expect(calculateScoreV2(answer(MIN, { isCorrect: false, partialCredit: 7 })).breakdown.correctness).toBe(500);
    expect(calculateScoreV2(answer(MIN, { isCorrect: false, partialCredit: -1 })).totalScore).toBe(50);
  });

  it("does not change its input", () => {
    const input = Object.freeze(answer(MIN, { isCorrect: false, partialCredit: 0.5, scoringMode: "binary" }));
    expect(() => calculateScoreV2(input)).not.toThrow();
    expect(input.partialCredit).toBe(0.5);
  });
});

describe("calculateScoreV2: solve-time layer", () => {
  it("is worth all 300 time points when no release time is given", () => {
    const r = calculateScoreV2(answer(0));
    expect(r.timing).toMatchObject({ solveWeight: 300, releaseWeight: 0, releaseActive: false, releaseMs: null });
  });

  it("measures from the stop's start to the answer, in milliseconds", () => {
    const r = calculateScoreV2(answer(4 * MIN + 250));
    expect(r.timing.solveMs).toBe(4 * MIN + 250);
    expect(r.breakdown.solveTime).toBe(Math.round(300 * (1 - Math.log(1 + (4 * MIN + 250) / (2 * MIN)) / Math.log(31))));
  });

  it("defaults to tau 2 minutes and a 60 minute window", () => {
    expect(SCORING_V2.solve).toEqual({ tauMs: 2 * MIN, windowMs: 60 * MIN });
    expect(calculateScoreV2(answer(2 * MIN)).breakdown.solveTime).toBe(Math.round(300 * (1 - Math.log(2) / Math.log(31))));
    expect(calculateScoreV2(answer(60 * MIN)).breakdown.solveTime).toBe(0);
    expect(calculateScoreV2(answer(3 * HOUR)).breakdown.solveTime).toBe(0);
  });

  it("accepts ISO strings and Dates as well as milliseconds", () => {
    const base = calculateScoreV2(answer(5 * MIN));
    const iso = calculateScoreV2({
      isCorrect: true,
      attemptNumber: 1,
      startedAt: new Date(START).toISOString(),
      answeredAt: new Date(START + 5 * MIN),
    });
    expect(iso.totalScore).toBe(base.totalScore);
    expect(iso.timing.solveMs).toBe(5 * MIN);
  });

  it("uses the hunt's own window when one is given", () => {
    const cityWide = calculateScoreV2(answer(60 * MIN, { solveWindowMs: 180 * MIN }));
    expect(cityWide.timing.solveWindowMs).toBe(180 * MIN);
    expect(cityWide.breakdown.solveTime).toBe(Math.round(300 * (1 - Math.log(31) / Math.log(91))));
    expect(cityWide.breakdown.solveTime).toBeGreaterThan(0);
    // A campus walk: a short window reaches zero sooner.
    expect(calculateScoreV2(answer(20 * MIN, { solveWindowMs: 20 * MIN })).breakdown.solveTime).toBe(0);
  });

  it("falls back to the default window for an unusable override", () => {
    for (const solveWindowMs of [0, -5, Number.NaN, null, undefined]) {
      expect(calculateScoreV2(answer(MIN, { solveWindowMs })).timing.solveWindowMs).toBe(60 * MIN);
    }
  });

  it("earns no time points when the start is unknown, and full points for a clock that ran backwards", () => {
    const unknown = calculateScoreV2(answer(MIN, { startedAt: null }));
    expect(unknown.timing.solveMs).toBeNull();
    expect(unknown.breakdown.solveTime).toBe(0);
    expect(unknown.totalScore).toBe(700);

    const garbage = calculateScoreV2(answer(MIN, { startedAt: "not a date" }));
    expect(garbage.breakdown.solveTime).toBe(0);

    const backwards = calculateScoreV2(answer(-30_000));
    expect(backwards.timing.solveMs).toBe(0);
    expect(backwards.breakdown.solveTime).toBe(300);
  });

  it("separates players a few seconds apart", () => {
    const a = calculateScoreV2(answer(3 * MIN));
    const b = calculateScoreV2(answer(3 * MIN + 5000));
    expect(a.totalScore).toBeGreaterThan(b.totalScore);
  });
});

describe("calculateScoreV2: release-time layer", () => {
  const released = START - 2 * HOUR;

  it("is off unless a release time is given", () => {
    for (const releasedAt of [undefined, null]) {
      const r = calculateScoreV2(answer(MIN, { releasedAt }));
      expect(r.timing.releaseActive).toBe(false);
      expect(r.breakdown.releaseTime).toBe(0);
      expect(r.timing.solveWeight).toBe(300);
    }
    // An unreadable release time is treated as not given.
    expect(calculateScoreV2(answer(MIN, { releasedAt: "soon" })).timing.releaseActive).toBe(false);
  });

  it("splits the 300 time points 150 / 150 when it is on", () => {
    const r = calculateScoreV2(answer(0, { releasedAt: START }));
    expect(r.timing).toMatchObject({ releaseActive: true, solveWeight: 150, releaseWeight: 150, releaseMs: 0 });
    expect(r.breakdown.solveTime).toBe(150);
    expect(r.breakdown.releaseTime).toBe(150);
    expect(r.totalScore).toBe(1000);
  });

  it("measures from the clue's release to the answer with tau 10 minutes and a 24 hour window", () => {
    expect(SCORING_V2.release).toEqual({ tauMs: 10 * MIN, windowMs: 24 * HOUR });
    const r = calculateScoreV2(answer(5 * MIN, { releasedAt: released }));
    expect(r.timing.releaseMs).toBe(2 * HOUR + 5 * MIN);
    expect(r.breakdown.releaseTime).toBe(Math.round(150 * (1 - Math.log(1 + 125 / 10) / Math.log(145))));
    expect(r.breakdown.solveTime).toBe(Math.round(150 * (1 - Math.log(3.5) / Math.log(31))));
  });

  it("reaches zero a day after release and stays there", () => {
    const atWindow = calculateScoreV2(answer(MIN, { releasedAt: START + MIN - 24 * HOUR }));
    expect(atWindow.breakdown.releaseTime).toBe(0);
    const weekLate = calculateScoreV2(answer(MIN, { releasedAt: START - 7 * 24 * HOUR }));
    expect(weekLate.breakdown.releaseTime).toBe(0);
    // A late joiner still competes on correctness and solve time.
    expect(weekLate.totalScore).toBe(700 + weekLate.breakdown.solveTime);
    expect(weekLate.breakdown.solveTime).toBeGreaterThan(100);
  });

  it("costs a day-8 joiner little more than a day-3 joiner", () => {
    const day = 24 * HOUR;
    const score = (lateBy: number) => calculateScoreV2(answer(MIN, { releasedAt: START - lateBy })).totalScore;
    expect(score(3 * day) - score(8 * day)).toBe(0);
    expect(score(HOUR) - score(6 * HOUR)).toBeLessThan(score(0) - score(HOUR));
  });

  it("gives full release points to an answer stamped before the release (clock skew)", () => {
    const r = calculateScoreV2(answer(MIN, { releasedAt: START + 10 * MIN }));
    expect(r.timing.releaseMs).toBe(0);
    expect(r.breakdown.releaseTime).toBe(150);
  });

  it("gives a wrong answer no release points", () => {
    const r = calculateScoreV2(answer(MIN, { isCorrect: false, releasedAt: START }));
    expect(r.breakdown.releaseTime).toBe(0);
    expect(r.totalScore).toBe(50);
  });
});

describe("calculateScoreV2: scoring modes", () => {
  it("standard allows five attempts", () => {
    expect(calculateScoreV2(answer(MIN, { isCorrect: false, attemptNumber: 4 })).feedback.canRetry).toBe(true);
    expect(calculateScoreV2(answer(MIN, { isCorrect: false, attemptNumber: 5 })).feedback.canRetry).toBe(false);
    expect(calculateScoreV2(answer(MIN)).feedback.canRetry).toBe(false);
  });

  it("binary gives no partial credit and no retries", () => {
    const r = calculateScoreV2(answer(MIN, { isCorrect: false, partialCredit: 0.8, scoringMode: "binary" }));
    expect(r.breakdown.correctness).toBe(0);
    expect(r.totalScore).toBe(50);
    expect(r.feedback).toMatchObject({ type: "incorrect", canRetry: false });
    expect(calculateScoreV2(answer(0, { scoringMode: "binary" })).totalScore).toBe(1000);
  });

  it("lenient makes hints free, doubles the floor and allows ten attempts", () => {
    const hinted = calculateScoreV2(answer(MIN, { clueHintsUsed: 3, challengeHintsUsed: 2, scoringMode: "lenient" }));
    expect(hinted.breakdown.hintPenalty).toBe(0);
    expect(hinted.totalScore).toBe(calculateScoreV2(answer(MIN)).totalScore);
    const wrong = calculateScoreV2(answer(MIN, { isCorrect: false, attemptNumber: 9, scoringMode: "lenient" }));
    expect(wrong.totalScore).toBe(100);
    expect(wrong.feedback.canRetry).toBe(true);
  });

  it("mastery allows practically unlimited retries and scores like standard", () => {
    const wrong = calculateScoreV2(answer(MIN, { isCorrect: false, attemptNumber: 50, scoringMode: "mastery" }));
    expect(wrong.feedback.canRetry).toBe(true);
    expect(calculateScoreV2(answer(MIN, { scoringMode: "mastery" })).totalScore).toBe(calculateScoreV2(answer(MIN)).totalScore);
  });

  it("means the same thing in each mode as version 1 does", () => {
    const v1 = (extra: Partial<ScoringInput>) =>
      calculateScore({ isCorrect: false, attemptNumber: 1, hintsUsed: 0, timeSpentSeconds: 60, isFirstAttempt: true, challengeType: "short_text", ...extra });
    const v2 = (extra: Partial<ScoringV2Input>) => calculateScoreV2(answer(MIN, { isCorrect: false, ...extra }));
    for (const scoringMode of ["standard", "binary", "lenient", "mastery"] as const) {
      for (const attemptNumber of [1, 2, 5, 10, 99]) {
        expect(v2({ scoringMode, attemptNumber }).feedback.canRetry).toBe(v1({ scoringMode, attemptNumber }).feedback.canRetry);
      }
      const withPartial = { scoringMode, partialCredit: 0.5 };
      expect(v2(withPartial).feedback.type).toBe(v1(withPartial).feedback.type);
    }
  });
});

describe("version 1 keeps producing the scores it does today", () => {
  const base: ScoringInput = {
    isCorrect: true,
    attemptNumber: 1,
    hintsUsed: 0,
    timeSpentSeconds: 30,
    isFirstAttempt: true,
    challengeType: "multiple_choice",
  };

  // Each row: what goes in, and the score version 1 gave before this change.
  const golden: [string, Partial<ScoringInput>, number][] = [
    ["correct, first attempt, no expected time", {}, 71],
    ["correct, first attempt, faster than 1.5x expected", { expectedTimeSeconds: 60 }, 72],
    ["correct, first attempt, slower than expected", { expectedTimeSeconds: 10 }, 71],
    ["correct on the second attempt", { attemptNumber: 2, isFirstAttempt: false }, 54],
    ["correct on the fifth attempt", { attemptNumber: 5, isFirstAttempt: false }, 27],
    ["correct with one clue hint and one challenge hint", { clueHintsUsed: 1, challengeHintsUsed: 1 }, 64],
    ["wrong", { isCorrect: false }, 8],
    ["wrong on the fifth attempt with four hints", { isCorrect: false, attemptNumber: 5, isFirstAttempt: false, challengeHintsUsed: 4 }, 5],
    ["half credit", { isCorrect: false, partialCredit: 0.5 }, 38],
    ["half credit in binary mode", { isCorrect: false, partialCredit: 0.5, scoringMode: "binary" }, 8],
    ["wrong in lenient mode", { isCorrect: false, scoringMode: "lenient" }, 13],
  ];

  it.each(golden)("%s", (_label, extra, expected) => {
    expect(calculateScore({ ...base, ...extra }).totalScore).toBe(expected);
  });

  it("no longer changes the input it is given", () => {
    const input = Object.freeze({ ...base, isCorrect: false, partialCredit: 0.5, scoringMode: "binary" as const });
    expect(() => calculateScore(input)).not.toThrow();
    expect(input.partialCredit).toBe(0.5);
    // Binary mode still ignores the partial credit.
    expect(calculateScore(input).feedback.type).toBe("incorrect");
  });
});
