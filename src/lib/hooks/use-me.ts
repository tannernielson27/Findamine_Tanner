"use client";

import { useCallback, useEffect, useState } from "react";

/** Shape of GET /api/v1/auth/me. Callers read the fields they need. */
export interface MeResponse {
  // The route returns the whole users row; callers narrow what they read.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user?: Record<string, any> | null;
  [key: string]: unknown;
}

/** Long enough to collapse the burst of shell + page lookups, short enough to never feel stale. */
const ME_TTL_MS = 5000;

let inflight: Promise<MeResponse | null> | null = null;
let cached: { at: number; data: MeResponse } | null = null;
// Bumped by invalidateMe() so a request that was already in flight can't repopulate the cache.
let generation = 0;

/**
 * GET /api/v1/auth/me with in-memory promise dedupe and a short cache.
 * Resolves to null on a non-OK response or network failure (never cached).
 * Pass `{ force: true }` to bypass the cache.
 */
export function fetchMe(options?: { force?: boolean }): Promise<MeResponse | null> {
  if (!options?.force) {
    if (cached && Date.now() - cached.at < ME_TTL_MS) return Promise.resolve(cached.data);
    if (inflight) return inflight;
  }
  const startedAt = generation;
  const request = fetch("/api/v1/auth/me")
    .then(async (res) => {
      if (!res.ok) return null;
      const data = (await res.json()) as MeResponse;
      if (startedAt === generation) cached = { at: Date.now(), data };
      return data;
    })
    .catch(() => null)
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

/** Drop the cached profile. Call after anything that mutates the user's profile/metadata. */
export function invalidateMe(): void {
  generation += 1;
  cached = null;
  inflight = null;
}

/** Test helper alias. */
export const resetMeCache = invalidateMe;

/**
 * The signed-in user's /auth/me payload, shared across the app.
 * `refresh()` re-fetches (bypassing the cache) and updates this hook's state.
 */
export function useMe(): {
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<MeResponse | null>;
} {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchMe().then((data) => {
      if (cancelled) return;
      setMe(data);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    invalidateMe();
    const data = await fetchMe({ force: true });
    setMe(data);
    setLoading(false);
    return data;
  }, []);

  return { me, loading, refresh };
}
