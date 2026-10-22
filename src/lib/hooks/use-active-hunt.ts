"use client";

import { useEffect, useState } from "react";
import { parseActiveHunt, type ActiveHunt } from "@/lib/play/active-hunt";

export interface ActiveHuntState {
  hunt: ActiveHunt | null;
  loading: boolean;
}

/**
 * The signed-in player's in-progress hunt, or null. A failed request is
 * treated as "none" so the resume UI simply stays hidden.
 */
export function useActiveHunt(enabled = true): ActiveHuntState {
  const [state, setState] = useState<ActiveHuntState>({ hunt: null, loading: enabled });
  const [prevEnabled, setPrevEnabled] = useState(enabled);

  // Re-enabling (e.g. leaving /play) refetches: drop the old hunt right away
  // so a just-finished hunt never flashes in the mini-bar.
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled) setState({ hunt: null, loading: true });
  }

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/v1/play/active", { signal: controller.signal, credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setState({ hunt: parseActiveHunt(json), loading: false }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({ hunt: null, loading: false });
      });
    return () => controller.abort();
  }, [enabled]);

  return state;
}
