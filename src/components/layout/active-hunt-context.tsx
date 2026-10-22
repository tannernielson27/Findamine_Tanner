"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useActiveHunt, type ActiveHuntState } from "@/lib/hooks/use-active-hunt";

const ActiveHuntContext = createContext<ActiveHuntState>({ hunt: null, loading: false });

/**
 * One GET /api/v1/play/active for the whole shell (mini-bar + Home resume
 * card). `enabled` is false while the player is on /play/*, so coming back
 * out of a hunt flips it on again and re-fetches: a just-finished hunt
 * disappears from the mini-bar without a reload.
 */
export function ActiveHuntProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const state = useActiveHunt(enabled);
  return <ActiveHuntContext.Provider value={state}>{children}</ActiveHuntContext.Provider>;
}

export function useShellActiveHunt(): ActiveHuntState {
  return useContext(ActiveHuntContext);
}
