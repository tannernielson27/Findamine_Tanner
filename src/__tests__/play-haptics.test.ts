import { describe, it, expect, vi, afterEach } from "vitest";

const calls = vi.hoisted(() => ({ impact: [] as unknown[], notification: [] as unknown[] }));

vi.mock("@capacitor/haptics", () => ({
  ImpactStyle: { Heavy: "HEAVY", Medium: "MEDIUM", Light: "LIGHT" },
  NotificationType: { Success: "SUCCESS", Warning: "WARNING", Error: "ERROR" },
  Haptics: {
    impact: async (opts: unknown) => {
      calls.impact.push(opts);
    },
    notification: async (opts: unknown) => {
      calls.notification.push(opts);
    },
  },
}));

import {
  HOT_LEVEL,
  hapticForHeatChange,
  hapticImpact,
  hapticSuccess,
  hapticsEnabled,
  heatLevel,
} from "@/lib/native/haptics";

const iosWindow = (reduceMotion = false) => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => "ios" },
  matchMedia: (q: string) => ({ matches: reduceMotion && q.includes("reduce") }),
});

afterEach(() => {
  vi.unstubAllGlobals();
  calls.impact.length = 0;
  calls.notification.length = 0;
});

/** Replays a stream of GPS readings through the change rule, like useHeatHaptics does. */
function replay(zones: (string | null)[]) {
  let prev: number | null = null;
  const out: (string | null)[] = [];
  for (const zone of zones) {
    const next = heatLevel(zone);
    out.push(hapticForHeatChange(prev, next));
    prev = next;
  }
  return out;
}

describe("heatLevel", () => {
  it("orders the server zones cold → hot", () => {
    expect(["icy", "cold", "warm", "hot", "burning"].map(heatLevel)).toEqual([1, 2, 3, 4, 5]);
  });

  it("is null for no reading or an unknown zone", () => {
    expect(heatLevel(null)).toBeNull();
    expect(heatLevel(undefined)).toBeNull();
    expect(heatLevel("lukewarm")).toBeNull();
  });
});

describe("hapticForHeatChange", () => {
  it("taps light on a rise below hot, medium on reaching hot or burning", () => {
    expect(hapticForHeatChange(1, 2)).toBe("light");
    expect(hapticForHeatChange(2, 3)).toBe("light");
    expect(hapticForHeatChange(3, HOT_LEVEL)).toBe("medium");
    expect(hapticForHeatChange(4, 5)).toBe("medium");
    expect(hapticForHeatChange(1, 5)).toBe("medium");
  });

  it("stays silent on the first reading, repeats, drops and lost readings", () => {
    expect(hapticForHeatChange(null, 3)).toBeNull();
    expect(hapticForHeatChange(3, 3)).toBeNull();
    expect(hapticForHeatChange(4, 2)).toBeNull();
    expect(hapticForHeatChange(3, null)).toBeNull();
  });

  it("fires once per level change, never on every GPS tick", () => {
    const ticks = ["icy", "icy", "icy", "cold", "cold", "cold", "warm", "warm", "hot", "hot", "hot", "burning", "burning"];
    const fired = replay(ticks).filter(Boolean);
    expect(fired).toEqual(["light", "light", "medium", "medium"]);
  });

  it("taps once for a rise after a drop, then stays quiet", () => {
    // warm → cold → warm: the drop is silent, the rise back taps once.
    expect(replay(["warm", "cold", "warm", "warm"])).toEqual([null, null, "light", null]);
  });

  it("treats a new stop (reading reset to null) as a fresh start", () => {
    expect(replay(["hot", null, "warm", "hot"])).toEqual([null, null, null, "medium"]);
  });
});

describe("haptic calls", () => {
  it("are a no-op on the web", async () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
    expect(hapticsEnabled()).toBe(false);
    await hapticImpact("medium");
    await hapticSuccess();
    expect(calls.impact).toEqual([]);
    expect(calls.notification).toEqual([]);
  });

  it("are off in the app when the player prefers reduced motion", async () => {
    vi.stubGlobal("window", iosWindow(true));
    expect(hapticsEnabled()).toBe(false);
    await hapticImpact("light");
    expect(calls.impact).toEqual([]);
  });

  it("play the plugin's impact and success patterns in the app", async () => {
    vi.stubGlobal("window", iosWindow(false));
    expect(hapticsEnabled()).toBe(true);
    await hapticImpact("light");
    await hapticImpact("medium");
    await hapticSuccess();
    expect(calls.impact).toEqual([{ style: "LIGHT" }, { style: "MEDIUM" }]);
    expect(calls.notification).toEqual([{ type: "SUCCESS" }]);
  });
});
