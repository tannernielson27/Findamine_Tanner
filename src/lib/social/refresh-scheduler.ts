/**
 * Decides when a live view (the leaderboard) refetches. Framework-free so the
 * timing rules can be unit tested.
 *
 * Two things ask for a refetch:
 *  - a ping: the server says "this board changed" (Realtime Broadcast);
 *  - the clock: a poll, in case a ping was missed or Realtime is down.
 *
 * Rules:
 *  - Fetches never overlap. A request that arrives mid-fetch causes at most one
 *    follow-up, after the running fetch has finished.
 *  - A burst of pings collapses into one fetch, and fetches start at least
 *    `minGapMs` apart, so many players scoring at once cannot cause a storm.
 *  - Nothing is fetched while the page is hidden (other than the first load).
 *    Coming back refetches straight away.
 *  - The poll interval counts from the end of the last fetch of any kind, so a
 *    ping-driven refetch replaces the next poll instead of adding to it.
 *  - Every wait carries a random part so the clients watching one board spread
 *    their requests out instead of all hitting the API in the same instant.
 */

export interface RefreshTiming {
  /** Fallback poll: time between fetches when no ping arrives. */
  pollIntervalMs: number;
  /** The poll interval varies by up to this much either way. */
  pollJitterMs: number;
  /** Wait after a ping before fetching, so a burst becomes one fetch. */
  pingDelayMs: number;
  /** Up to this much extra wait after a ping, different for every client. */
  pingJitterMs: number;
  /** Fetches never start closer together than this. */
  minGapMs: number;
}

/**
 * Leaderboard timing. A single change shows within about two seconds (at most
 * 1 s of waiting plus the fetch); under a flood each client still makes at
 * most one request every two seconds; with no pings at all the board is at
 * most ~17 s behind.
 */
export const LEADERBOARD_REFRESH_TIMING: RefreshTiming = {
  pollIntervalMs: 15_000,
  pollJitterMs: 2_000,
  pingDelayMs: 300,
  pingJitterMs: 700,
  minGapMs: 2_000,
};

export interface RefreshSchedulerOptions {
  /**
   * Fetch and apply fresh data. It decides what a failure means for the view
   * (the leaderboard keeps its last good data); a rejection here only ends
   * that attempt, and polling carries on.
   */
  refresh: () => Promise<unknown>;
  timing: RefreshTiming;
  /** Source of jitter, 0 <= n < 1. Replaceable for tests. */
  random?: () => number;
}

export interface RefreshScheduler {
  /** Do the first load now (whether or not the page is visible) and begin scheduling. */
  start(visible: boolean): void;
  /** Something changed on the server: refetch soon, collapsing bursts. */
  ping(): void;
  /** Data may be stale (window focus, Realtime reconnected): refetch as soon as allowed. */
  refreshNow(): void;
  /** Page shown or hidden. Showing it refetches straight away. */
  setVisible(visible: boolean): void;
  /** Cancel everything. A fetch already running is left to finish. */
  stop(): void;
}

interface PendingFetch {
  dueAt: number;
  handle: ReturnType<typeof setTimeout>;
}

export function createRefreshScheduler({
  refresh,
  timing,
  random = Math.random,
}: RefreshSchedulerOptions): RefreshScheduler {
  let started = false;
  let stopped = false;
  let visible = true;
  let inFlight = false;
  /** Set when a request arrives mid-fetch: the running fetch may predate the change. */
  let followUp = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let pending: PendingFetch | null = null;

  const pollDelay = () => timing.pollIntervalMs + (random() * 2 - 1) * timing.pollJitterMs;
  const pingDelay = () => timing.pingDelayMs + random() * timing.pingJitterMs;
  const earliestStart = () => Math.max(Date.now(), lastStartedAt + timing.minGapMs);
  const idle = () => started && !stopped && visible;

  function cancelPending(): void {
    if (pending) clearTimeout(pending.handle);
    pending = null;
  }

  /** Fetch at `dueAt`, unless a fetch is already due sooner (it covers this one). */
  function fetchAt(dueAt: number): void {
    if (pending && pending.dueAt <= dueAt) return;
    cancelPending();
    const delay = Math.max(0, Math.round(dueAt - Date.now()));
    pending = { dueAt, handle: setTimeout(run, delay) };
  }

  function run(): void {
    pending = null;
    if (stopped || inFlight) return;
    inFlight = true;
    followUp = false;
    lastStartedAt = Date.now();
    // Called synchronously; a throw becomes a rejection like any other failure.
    new Promise<unknown>((resolve) => resolve(refresh()))
      // The view keeps its last good data on failure; the next poll retries.
      .catch(() => undefined)
      .then(() => {
        inFlight = false;
        if (!idle()) return;
        fetchAt(followUp ? earliestStart() : Date.now() + pollDelay());
      });
  }

  function refreshNow(): void {
    if (!idle()) return;
    if (inFlight) {
      // A fetch that has only just started is fresh enough. One left hanging
      // (the app was suspended mid-request) is not: follow it up.
      if (Date.now() - lastStartedAt >= timing.minGapMs) followUp = true;
      return;
    }
    fetchAt(earliestStart());
  }

  return {
    start(isVisible: boolean): void {
      if (started || stopped) return;
      started = true;
      visible = isVisible;
      run();
    },

    ping(): void {
      // Hidden: skip it. Becoming visible refetches anyway.
      if (!idle()) return;
      if (inFlight) {
        followUp = true;
        return;
      }
      fetchAt(Math.max(Date.now() + pingDelay(), lastStartedAt + timing.minGapMs));
    },

    refreshNow,

    setVisible(isVisible: boolean): void {
      if (stopped || isVisible === visible) return;
      visible = isVisible;
      if (isVisible) refreshNow();
      else cancelPending();
    },

    stop(): void {
      stopped = true;
      cancelPending();
    },
  };
}
