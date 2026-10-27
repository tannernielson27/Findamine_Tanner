"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { locationSupported, watchLocation } from "@/lib/native/geolocation";
import { safeFetch } from "@/lib/play/play-api";
import { heatLevel } from "@/lib/native/haptics";
import { arriveDelayMs, isMeaningfulFix, type Fix } from "@/lib/play/geo-filter";
import type { Find, GpsStatus, HotCold, LocationConsent, StopStep } from "@/lib/play/play-types";

export interface UserPosition {
  lat: number;
  lng: number;
  /** Metres, when the platform reports it. */
  accuracy: number | null;
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
    let lastAccepted: Fix | null = null;
    let lastSentAt: number | null = null;
    let nearTarget = false;
    let pending: Fix | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const ping = async (fix: Fix) => {
      // One request at a time: parallel in-radius pings could record two arrivals.
      if (arriveInFlightRef.current) {
        pending = fix; // retried when the in-flight one settles
        return;
      }
      arriveInFlightRef.current = true;
      lastSentAt = Date.now();
      try {
        const res = await safeFetch(`/api/v1/play/${huntId}/arrive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            find_id: currentFind.id,
            latitude: fix.lat,
            longitude: fix.lng,
          }),
        });
        const data = await res.json();
        if (!active) return;

        if (data.hot_cold) {
          nearTarget = (heatLevel(data.hot_cold.zone) ?? 0) >= 4;
          callbacksRef.current.onHotCold(data.hot_cold);
        }
        if (data.arrived) callbacksRef.current.onArrived();
      } catch {
        // Network error during GPS ping — don't block navigation. Forget the
        // accepted fix so a stationary player's next fix is sent again.
        lastAccepted = null;
      } finally {
        arriveInFlightRef.current = false;
        if (active && pending) schedule(pending);
      }
    };

    // Sends the newest fix once the throttle window allows, so the last fix
    // before the player stops is never dropped (arrival isn't delayed past it).
    const schedule = (fix: Fix) => {
      pending = fix;
      if (timer) return;
      const delay = arriveDelayMs(lastSentAt, Date.now(), nearTarget);
      timer = setTimeout(() => {
        timer = null;
        const next = pending;
        pending = null;
        if (active && next) void ping(next);
      }, delay);
    };

    // navigator.geolocation on the web, Core Location in the iOS app.
    const stopWatching = watchLocation(
      (pos) => {
        if (!active) return;
        setGpsStatus("active");
        const fix: Fix = { lat: pos.latitude, lng: pos.longitude, accuracy: pos.accuracy };
        // Sub-3 m jitter changes nothing on screen or on the server.
        if (!isMeaningfulFix(lastAccepted, fix)) return;
        lastAccepted = fix;
        setUserPos({ lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy });
        schedule(fix);
      },
      (kind) => {
        if (active) setGpsStatus(kind);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      active = false;
      pending = null;
      if (timer) clearTimeout(timer);
      stopWatching();
    };
  }, [step, currentFind, huntId, locationConsent]);

  return { gpsStatus, setGpsStatus, userPos };
}
