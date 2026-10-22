"use client";

/**
 * The viewer's position for Explore (distances, "Near me" sorting, the map
 * dot). Kept in memory for the tab's lifetime only: never stored, never put
 * in the URL, never sent to the server.
 *
 * Nothing here raises a permission prompt on its own. `useSilentLocation`
 * reads a fix only when the permission is already granted; asking happens
 * when the player taps "Near me" (ExploreControls shows the primer first).
 */
import { useEffect, useSyncExternalStore } from "react";
import { getCurrentLocation } from "@/lib/native/geolocation";
import { queryPlatformPermission } from "@/lib/native/permissions";

export interface ExploreOrigin {
  lat: number;
  lng: number;
}

let origin: ExploreOrigin | null = null;
let silentTried = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setOrigin(next: ExploreOrigin): void {
  origin = next;
  listeners.forEach((l) => l());
}

const FIX_OPTIONS = { enableHighAccuracy: false, maximumAge: 120_000, timeout: 15_000 };

/** Gets one fix and shares it. Rejects with a LocationError. Call only after the primer. */
export async function requestExploreLocation(): Promise<ExploreOrigin> {
  const fix = await getCurrentLocation(FIX_OPTIONS);
  const next = { lat: fix.latitude, lng: fix.longitude };
  setOrigin(next);
  return next;
}

/** Current shared position, or null. */
export function useExploreOrigin(): ExploreOrigin | null {
  return useSyncExternalStore(subscribe, () => origin, () => null);
}

/**
 * Same as useExploreOrigin, and also reads a fix once per tab if location is
 * already granted (no prompt). Used for distances on cards and the detail page.
 */
export function useSilentLocation(): ExploreOrigin | null {
  const current = useExploreOrigin();
  useEffect(() => {
    if (origin || silentTried) return;
    silentTried = true;
    void queryPlatformPermission("location").then((status) => {
      if (status !== "granted") return;
      requestExploreLocation().catch(() => {
        // A failed silent fix just means no distances; the chip can ask again.
      });
    });
  }, []);
  return current;
}
