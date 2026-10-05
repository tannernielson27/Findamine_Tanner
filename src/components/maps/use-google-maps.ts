"use client";

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

export interface GoogleMapsState {
  /** True once the Maps API is ready to render. */
  isLoaded: boolean;
  /** Plain-language reason the map can't be shown, or null if it can (or is still loading). */
  unavailableReason: string | null;
}

export function useGoogleMaps(): GoogleMapsState {
  const { isLoaded, loadError } = useJsApiLoader(LOADER_OPTIONS);

  if (!GOOGLE_MAPS_API_KEY) {
    return { isLoaded: false, unavailableReason: "The map isn't set up on this site (no Google Maps key configured)." };
  }
  if (loadError) {
    return { isLoaded: false, unavailableReason: "The map couldn't be loaded. Check your connection and reload the page." };
  }
  return { isLoaded, unavailableReason: null };
}
