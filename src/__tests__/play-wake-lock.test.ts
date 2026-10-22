import { describe, it, expect } from "vitest";
import { holdWakeLock, type WakeLockSentinelLike } from "@/lib/play/use-wake-lock";

function fakes(opts: { refuse?: boolean } = {}) {
  const sentinels: (WakeLockSentinelLike & { released: boolean })[] = [];
  let listener: (() => void) | null = null;
  const doc = {
    visibilityState: "visible",
    addEventListener: (_t: "visibilitychange", fn: () => void) => {
      listener = fn;
    },
    removeEventListener: (_t: "visibilitychange", fn: () => void) => {
      if (listener === fn) listener = null;
    },
  };
  const api = {
    request: async () => {
      if (opts.refuse) throw new DOMException("not allowed", "NotAllowedError");
      const s = {
        released: false,
        release: async () => {
          s.released = true;
        },
      };
      sentinels.push(s);
      return s;
    },
  };
  const fire = () => listener?.();
  return { doc, api, sentinels, fire, hasListener: () => listener !== null };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("holdWakeLock", () => {
  it("takes the lock at once and releases it on stop", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc);
    await tick();
    expect(f.sentinels).toHaveLength(1);
    expect(f.sentinels[0].released).toBe(false);
    stop();
    expect(f.sentinels[0].released).toBe(true);
    expect(f.hasListener()).toBe(false);
  });

  it("re-acquires when the page becomes visible after the browser dropped the lock", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc);
    await tick();
    // The browser releases the lock when the tab is hidden.
    f.doc.visibilityState = "hidden";
    f.sentinels[0].released = true;
    f.fire();
    await tick();
    expect(f.sentinels).toHaveLength(1);
    f.doc.visibilityState = "visible";
    f.fire();
    await tick();
    expect(f.sentinels).toHaveLength(2);
    expect(f.sentinels[1].released).toBe(false);
    stop();
    expect(f.sentinels[1].released).toBe(true);
  });

  it("doesn't stack locks while one is still held", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc);
    await tick();
    f.fire();
    f.fire();
    await tick();
    expect(f.sentinels).toHaveLength(1);
    stop();
  });

  it("releases a lock that arrives after stop", async () => {
    const f = fakes();
    const stop = holdWakeLock(f.api, f.doc);
    stop();
    await tick();
    expect(f.sentinels).toHaveLength(1);
    expect(f.sentinels[0].released).toBe(true);
  });

  it("shrugs off a refused request", async () => {
    const f = fakes({ refuse: true });
    const stop = holdWakeLock(f.api, f.doc);
    await tick();
    expect(() => stop()).not.toThrow();
  });
});
