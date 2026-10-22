"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { locationSupported, watchLocation } from "@/lib/native/geolocation";
import { safeFetch } from "@/lib/play/play-api";
import type { Find, GpsStatus, HotCold, LocationConsent, StopStep } from "@/lib/play/play-types";

export interface UserPosition {
  lat: number;
  lng: number;
}

interface GeoTrackingInput {
  huntId: string | string[] | undefined;
  step: StopStep;
  currentFind: Find | undefined;
  locationConsent: LocationConsent;
  /** A hot/cold reading came back from the arrive endpoint. */
  onHotCold: (hotCold: HotCold) => void;
  /** The server says the player is inside the stop's radius. */
  onArrived: () => void;
}

export interface GeoTracking {
  gpsStatus: GpsStatus;
  setGpsStatus: Dispatch<SetStateAction<GpsStatus>>;
  userPos: UserPosition | null;
}

/**
 * Watches the player's position during the navigate step and pings the
 * arrive endpoint with each fix. Starts only after the location primer
 * (locationConsent === "granted") so the OS prompt follows an explanation.
 */
export function useGeoTracking({
  huntId,
  step,
  currentFind,
  locationConsent,
  onHotCold,
  onArrived,
}: GeoTrackingInput): GeoTracking {
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("waiting");
  const [userPos, setUserPos] = useState<UserPosition | null>(null);
  // Only one arrive request at a time: watchPosition fires faster than the
  // server answers, and parallel in-radius pings could record two arrivals.
  const arriveInFlightRef = useRef(false);
  const callbacksRef = useRef({ onHotCold, onArrived });

  useEffect(() => {
    callbacksRef.current = { onHotCold, onArrived };
  }, [onHotCold, onArrived]);

  useEffect(() => {
    if (step !== "navigate" || !currentFind) return;
    // Wait for the location primer: the OS prompt must follow an explanation.
    if (locationConsent !== "granted") return;

    if (!locationSupported()) {
      setGpsStatus("unavailable");
      return;
    }

    // Set false on cleanup so a reply that lands after the player has moved on
    // (or left this step) can't push the wrong stop into the challenge.
    let active = true;

    // navigator.geolocation on the web, Core Location in the iOS app.
    const stopWatching = watchLocation(
      async (pos) => {
        if (!active) return;
        setGpsStatus("active");
        setUserPos({ lat: pos.latitude, lng: pos.longitude });
        // Skip this fix if the previous ping is still in flight; the next
        // position update will try again.
        if (arriveInFlightRef.current) return;
        arriveInFlightRef.current = true;
        try {
          const res = await safeFetch(`/api/v1/play/${huntId}/arrive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              find_id: currentFind.id,
              latitude: pos.latitude,
              longitude: pos.longitude,
            }),
          });
          const data = await res.json();
          if (!active) return;

          if (data.hot_cold) callbacksRef.current.onHotCold(data.hot_cold);
          if (data.arrived) callbacksRef.current.onArrived();
        } catch {
          // Network error during GPS ping — don't block navigation,
          // just keep trying on next position update
        } finally {
          arriveInFlightRef.current = false;
        }
      },
      (kind) => {
        if (active) setGpsStatus(kind);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      active = false;
      stopWatching();
    };
  }, [step, currentFind, huntId, locationConsent]);

  return { gpsStatus, setGpsStatus, userPos };
}
