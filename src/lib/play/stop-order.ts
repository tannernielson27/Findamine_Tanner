/**
 * Stop order for a play session.
 *
 * A creator can turn on "Shuffle stops" (hunt metadata `shuffle_stops`). Each
 * player then gets the stops in their own random order. The shuffle is seeded
 * by the play session id, so the order is stable for that session: a reload or
 * a resume from Home lands on the same next stop. A new session (replay)
 * draws a new order.
 *
 * Pure: no I/O, unit tested directly.
 */

/** The hunt metadata key the creator toggles. */
export const SHUFFLE_STOPS_KEY = "shuffle_stops";

interface Ordered {
  sort_order: number | null;
}

/** True when the hunt's metadata asks for a shuffled stop order. */
export function isShuffled(metadata: Readonly<Record<string, unknown>> | null | undefined): boolean {
  return metadata?.[SHUFFLE_STOPS_KEY] === true;
}

/** 32-bit FNV-1a hash of a string, used as the shuffle seed. */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, deterministic PRNG returning floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A new array with the items in a random order fixed by `seed` (Fisher–Yates). */
export function seededShuffle<T>(items: ReadonlyArray<T>, seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hashSeed(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The order a player does the stops in: the creator's order, or, when the hunt
 * is shuffled and a session seed is known, that session's shuffled order.
 * Never mutates the input.
 */
export function orderStops<T extends Ordered>(
  finds: ReadonlyArray<T>,
  opts: { shuffle: boolean; seed: string | null | undefined }
): T[] {
  const byCreator = [...finds].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  return opts.shuffle && opts.seed ? seededShuffle(byCreator, opts.seed) : byCreator;
}
