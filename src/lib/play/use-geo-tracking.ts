"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { locationSupported, watchLocation } from "@/lib/native/geolocation";
import { safeFetch } from "@/lib/play/play-api";
import { heatLevel } from "@/lib/native/haptics";
import { arriveDelayMs, isMeaningfulFix, type Fix } from "@/lib/play/geo-filter";
import {
  clearLegStart,
  isVagueFix,
  legStartAfterReply,
  legStartToSend,
  loadLegStart,
  saveLegStart,
} from "@/lib/play/leg-start";
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
  /**
   * False on Hard hunts (lib/play/navigation-help): the position is still
   * watched, so GPS status and "I'm here" work, but no fix is sent to the
   * server. There is no meter to feed, and arrival is by tapping "I'm here".
   */
  sendFixes?: boolean;
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
  sendFixes = true,
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
    // The zone on screen, sent back so the server can hold it steady while
    // GPS noise wobbles a reading across a zone boundary.
    let lastZone: string | null = null;
    // How far away the walk to this stop began: the meter is scaled to it.
    // Saved on the device so a reload mid-walk doesn't restart the meter.
    const huntKey = String(huntId);
    let legStart = loadLegStart(huntKey, currentFind.id);
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
      const vague = isVagueFix(fix.accuracy);
      const sentLegStart = legStartToSend(legStart, vague);
      try {
        const res = await safeFetch(`/api/v1/play/${huntId}/arrive`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            find_id: currentFind.id,
            latitude: fix.lat,
            longitude: fix.lng,
            accuracy: fix.accuracy,
            ...(sentLegStart !== null ? { leg_start: sentLegStart } : {}),
            ...(lastZone ? { last_zone: lastZone } : {}),
          }),
        });
        const data = await res.json();
        if (!active) return;

        if (data.hot_cold) {
          const nextLegStart = data.arrived ? legStart : legStartAfterReply(legStart, sentLegStart, data.distance, vague);
          if (nextLegStart && nextLegStart !== legStart) {
            legStart = nextLegStart;
            saveLegStart(huntKey, currentFind.id, nextLegStart);
          }
          lastZone = data.hot_cold.zone;
          nearTarget = (heatLevel(data.hot_cold.zone) ?? 0) >= 4;
          callbacksRef.current.onHotCold(data.hot_cold);
        }
        if (data.arrived) {
          // The leg is over: a replay, or walking off and coming back, starts a new one.
          legStart = null;
          clearLegStart(huntKey, currentFind.id);
          callbacksRef.current.onArrived();
        }
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
        if (sendFixes) schedule(fix);
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
  }, [step, currentFind, huntId, locationConsent, sendFixes]);

  return { gpsStatus, setGpsStatus, userPos };
}
