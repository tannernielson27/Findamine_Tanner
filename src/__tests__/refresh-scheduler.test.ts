import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRefreshScheduler,
  LEADERBOARD_REFRESH_TIMING,
  type RefreshTiming,
} from "@/lib/social/refresh-scheduler";

// No jitter unless a test asks for it, so every delay below is exact.
const TIMING: RefreshTiming = {
  pollIntervalMs: 15_000,
  pollJitterMs: 0,
  pingDelayMs: 300,
  pingJitterMs: 0,
  minGapMs: 2_000,
};

/** A scheduler whose fetches stay "in flight" until the test finishes them. */
function harness(timing: Partial<RefreshTiming> = {}, random: () => number = () => 0.5) {
  const inFlight: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
  let running = 0;
  let maxRunning = 0;
  const refresh = vi.fn(() => {
    running += 1;
    maxRunning = Math.max(maxRunning, running);
    return new Promise<void>((resolve, reject) => inFlight.push({ resolve, reject }));
  });
  const scheduler = createRefreshScheduler({ refresh, timing: { ...TIMING, ...timing }, random });
  const settle = async (fail = false) => {
    const next = inFlight.shift();
    if (!next) throw new Error("no fetch in flight");
    running -= 1;
    if (fail) next.reject(new Error("network down"));
    else next.resolve();
    await vi.advanceTimersByTimeAsync(0);
  };
  /** Start the scheduler and let the first load finish. */
  const startLoaded = async (visible = true) => {
    scheduler.start(visible);
    await settle();
  };
  return {
    refresh,
    scheduler,
    settle,
    startLoaded,
    maxRunning: () => maxRunning,
    advance: (ms: number) => vi.advanceTimersByTimeAsync(ms),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-18T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("first load", () => {
  it("loads straight away", () => {
    const h = harness();
    h.scheduler.start(true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("loads even when the page starts hidden, then waits", async () => {
    const h = harness();
    await h.startLoaded(false);
    await h.advance(60_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("starting twice does not load twice", () => {
    const h = harness();
    h.scheduler.start(true);
    h.scheduler.start(true);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("polling fallback", () => {
  it("refetches every poll interval while visible", async () => {
    const h = harness();
    await h.startLoaded();

    await h.advance(14_999);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(2);

    await h.settle();
    await h.advance(15_000);
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it("counts the interval from when the last fetch finished, so a slow fetch never overlaps the next", async () => {
    const h = harness();
    h.scheduler.start(true);
    await h.advance(40_000); // first load still in flight
    expect(h.refresh).toHaveBeenCalledTimes(1);

    await h.settle();
    await h.advance(15_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    expect(h.maxRunning()).toBe(1);
  });

  it("stops while the page is hidden", async () => {
    const h = harness();
    await h.startLoaded();
    h.scheduler.setVisible(false);
    await h.advance(120_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("refetches at once when the page is visible again, then resumes polling", async () => {
    const h = harness();
    await h.startLoaded();
    h.scheduler.setVisible(false);
    await h.advance(120_000);

    h.scheduler.setVisible(true);
    await h.advance(0);
    expect(h.refresh).toHaveBeenCalledTimes(2);

    await h.settle();
    await h.advance(15_000);
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it("keeps polling after a failed fetch", async () => {
    const h = harness();
    h.scheduler.start(true);
    await h.settle(true);
    await h.advance(15_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("spreads clients out: the interval varies by the jitter, never beyond it", async () => {
    const early = harness({ pollJitterMs: 2_000 }, () => 0);
    await early.startLoaded();
    await early.advance(12_999);
    expect(early.refresh).toHaveBeenCalledTimes(1);
    await early.advance(1);
    expect(early.refresh).toHaveBeenCalledTimes(2);

    const late = harness({ pollJitterMs: 2_000 }, () => 0.999999);
    await late.startLoaded();
    await late.advance(16_990);
    expect(late.refresh).toHaveBeenCalledTimes(1);
    await late.advance(10);
    expect(late.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("pings", () => {
  it("refetches shortly after a ping, well inside two seconds", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(5_000);

    h.scheduler.ping();
    await h.advance(299);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("collapses a burst of pings into one refetch", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(5_000);

    for (let i = 0; i < 40; i++) {
      h.scheduler.ping();
      await h.advance(5);
    }
    await h.advance(1_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("never overlaps: pings during a fetch cause exactly one follow-up after it finishes", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(5_000);
    h.scheduler.ping();
    await h.advance(300);
    expect(h.refresh).toHaveBeenCalledTimes(2);

    // The change these pings announce may have landed after fetch #2 read the board.
    h.scheduler.ping();
    h.scheduler.ping();
    h.scheduler.ping();
    await h.advance(10_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);

    await h.settle();
    await h.advance(300);
    expect(h.refresh).toHaveBeenCalledTimes(3);
    await h.settle();
    await h.advance(1_000);
    expect(h.refresh).toHaveBeenCalledTimes(3);
    expect(h.maxRunning()).toBe(1);
  });

  it("under a sustained flood, fetches start at least the minimum gap apart", async () => {
    const startedAt: number[] = [];
    let running = 0;
    let maxRunning = 0;
    // Each fetch takes 200 ms.
    const refresh = vi.fn(() => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      startedAt.push(Date.now());
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          running -= 1;
          resolve();
        }, 200)
      );
    });
    const scheduler = createRefreshScheduler({ refresh, timing: TIMING, random: () => 0.5 });
    scheduler.start(true);
    await vi.advanceTimersByTimeAsync(5_000);

    // A ping every 50 ms for 10 s: 200 pings.
    for (let t = 0; t < 10_000; t += 50) {
      scheduler.ping();
      await vi.advanceTimersByTimeAsync(50);
    }

    const gaps = startedAt.slice(1).map((t, i) => t - startedAt[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2_000);
    expect(maxRunning).toBe(1);
    // The first load plus about one fetch per two seconds of flood, not 200.
    expect(startedAt.length).toBeGreaterThanOrEqual(5);
    expect(startedAt.length).toBeLessThanOrEqual(7);
  });

  it("spreads clients out: each waits the base delay plus its own jitter", async () => {
    const h = harness({ pingJitterMs: 700 }, () => 0.5);
    await h.startLoaded();
    await h.advance(5_000);

    h.scheduler.ping();
    await h.advance(649);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("a ping-driven refetch restarts the poll clock instead of adding to it", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(14_000);
    h.scheduler.ping();
    await h.advance(300);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    await h.settle();

    await h.advance(14_999);
    expect(h.refresh).toHaveBeenCalledTimes(2);
    await h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(3);
  });

  it("ignores pings while hidden; coming back refetches once", async () => {
    const h = harness();
    await h.startLoaded();
    h.scheduler.setVisible(false);
    h.scheduler.ping();
    h.scheduler.ping();
    await h.advance(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);

    h.scheduler.setVisible(true);
    await h.advance(0);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("ignores pings before start", async () => {
    const h = harness();
    h.scheduler.ping();
    await h.advance(5_000);
    expect(h.refresh).not.toHaveBeenCalled();
  });
});

describe("refreshNow (window focus, reconnect)", () => {
  it("refetches immediately", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(5_000);
    h.scheduler.refreshNow();
    await h.advance(0);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("visible + focus + reconnect arriving together cause one fetch", async () => {
    const h = harness();
    await h.startLoaded();
    h.scheduler.setVisible(false);
    await h.advance(60_000);

    h.scheduler.setVisible(true);
    h.scheduler.refreshNow();
    h.scheduler.refreshNow();
    await h.advance(0);
    expect(h.refresh).toHaveBeenCalledTimes(2);

    await h.settle();
    await h.advance(10_000);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("is held to the minimum gap after the previous fetch", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(500);

    h.scheduler.refreshNow();
    await h.advance(1_499);
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await h.advance(1);
    expect(h.refresh).toHaveBeenCalledTimes(2);
  });

  it("follows up a fetch that was left hanging (app suspended mid-request)", async () => {
    const h = harness();
    await h.startLoaded();
    await h.advance(15_000);
    expect(h.refresh).toHaveBeenCalledTimes(2); // this poll hangs
    h.scheduler.setVisible(false);
    await h.advance(600_000);

    h.scheduler.setVisible(true);
    await h.advance(0);
    expect(h.refresh).toHaveBeenCalledTimes(2); // still not overlapping

    await h.settle(true);
    await h.advance(0);
    expect(h.refresh).toHaveBeenCalledTimes(3);
    expect(h.maxRunning()).toBe(1);
  });

  it("does nothing while hidden", async () => {
    const h = harness();
    await h.startLoaded();
    h.scheduler.setVisible(false);
    h.scheduler.refreshNow();
    await h.advance(30_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("stop", () => {
  it("cancels the pending poll and ignores everything afterwards", async () => {
    const h = harness();
    await h.startLoaded();
    h.scheduler.stop();
    h.scheduler.ping();
    h.scheduler.refreshNow();
    h.scheduler.setVisible(true);
    await h.advance(60_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });

  it("does not schedule anything when a fetch finishes after stop", async () => {
    const h = harness();
    h.scheduler.start(true);
    h.scheduler.ping();
    h.scheduler.stop();
    await h.settle();
    await h.advance(60_000);
    expect(h.refresh).toHaveBeenCalledTimes(1);
  });
});

describe("leaderboard timing", () => {
  it("polls about every 15 seconds", () => {
    expect(LEADERBOARD_REFRESH_TIMING.pollIntervalMs).toBe(15_000);
    expect(LEADERBOARD_REFRESH_TIMING.pollJitterMs).toBeLessThanOrEqual(3_000);
  });

  it("shows a single change within about two seconds (wait + a typical fetch)", () => {
    const { pingDelayMs, pingJitterMs } = LEADERBOARD_REFRESH_TIMING;
    expect(pingDelayMs + pingJitterMs).toBeLessThanOrEqual(1_200);
  });

  it("caps each client at one fetch every couple of seconds", () => {
    expect(LEADERBOARD_REFRESH_TIMING.minGapMs).toBeGreaterThanOrEqual(1_500);
  });
});
