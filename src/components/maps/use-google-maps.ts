"use client";

import { useSyncExternalStore } from "react";
import { useJsApiLoader } from "@react-google-maps/api";

const GOOGLE_MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

/**
 * The Google Maps script loader is a page-wide singleton: calling it a second
 * time with different options (e.g. one map asking for `libraries: ["places"]`
 * and another not) throws "Loader must not be called again with different
 * options" as soon as the user client-navigates between the two maps. Every map
 * component must therefore load through this one hook, with this one options
 * object. Nothing here needs the Places library — address search uses the
 * Geocoder, which is part of the core API.
 */
const LOADER_OPTIONS = {
  id: "findamine-google-maps",
  googleMapsApiKey: GOOGLE_MAPS_API_KEY,
};

/* ─── Auth failure (e.g. RefererNotAllowedMapError) ─────────────────────
   With a referrer-restricted key the script loads fine, then Google replaces
   every map with its own "Oops! Something went wrong" box and calls the
   global `gm_authFailure`. We record that once per page so every map can
   show its own fallback instead. */

declare global {
  interface Window {
    gm_authFailure?: () => void;
  }
}

let authFailed = false;
const listeners = new Set<() => void>();

function installAuthFailureHook(): void {
  if (typeof window === "undefined") return;
  const previous = window.gm_authFailure;
  if ((previous as { fmHook?: boolean } | undefined)?.fmHook) return;
  const hook = Object.assign(
    () => {
      authFailed = true;
      listeners.forEach((notify) => notify());
      previous?.();
    },
    { fmHook: true }
  );
  window.gm_authFailure = hook;
}

// Must be in place before the Maps script runs, so install on module load.
installAuthFailureHook();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

const getAuthFailed = () => authFailed;
const getServerAuthFailed = () => false;

export interface GoogleMapsState {
  /** True once the Maps API is ready to render. */
  isLoaded: boolean;
  /** Plain-language reason the map can't be shown, or null if it can (or is still loading). */
  unavailableReason: string | null;
}

export function useGoogleMaps(): GoogleMapsState {
  const { isLoaded, loadError } = useJsApiLoader(LOADER_OPTIONS);
  const rejected = useSyncExternalStore(subscribe, getAuthFailed, getServerAuthFailed);

  if (!GOOGLE_MAPS_API_KEY) {
    return { isLoaded: false, unavailableReason: "The map isn't set up on this site (no Google Maps key configured)." };
  }
  if (loadError) {
    return { isLoaded: false, unavailableReason: "The map couldn't be loaded. Check your connection and reload the page." };
  }
  if (rejected) {
    return { isLoaded: false, unavailableReason: "The map isn't available on this site right now." };
  }
  return { isLoaded, unavailableReason: null };
}
