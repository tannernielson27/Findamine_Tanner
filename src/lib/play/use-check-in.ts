"use client";

import { useCallback, useState } from "react";
import { getCurrentLocation, locationSupported } from "@/lib/native/geolocation";
import { errorMessage, postJsonStrict, safeFetch } from "@/lib/play/play-api";
import { interpretCheckIn, type PhotoCheckInReason } from "@/lib/play/check-in";
import type { UserPosition } from "@/lib/play/use-geo-tracking";
import type { Find, LocationConsent } from "@/lib/play/play-types";

interface CheckInInput {
  huntId: string | string[] | undefined;
  currentFind: Find | undefined;
  userPos: UserPosition | null;
  locationConsent: LocationConsent;
  setError: (message: string | null) => void;
  /** The server recorded the arrival. */
  onArrived: () => void;
}

export interface CheckIn {
  /** Set when GPS can't confirm the player, so a photo check-in is offered. */
  photoCheckIn: PhotoCheckInReason | null;
  handleCheckIn: () => Promise<void>;
  handlePhotoCheckIn: (file: File) => Promise<void>;
  cancelPhotoCheckIn: () => void;
}

/** A fresh, high-accuracy fix for the tap; falls back to the last tracked one. */
async function freshPosition(consent: LocationConsent, last: UserPosition | null): Promise<UserPosition | null> {
  // Without consent from the primer, asking now would raise the OS prompt cold.
  if (consent !== "granted" || !locationSupported()) return last;
  try {
    const fix = await getCurrentLocation({ enableHighAccuracy: true, maximumAge: 0, timeout: 10000 });
    return { lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy };
  } catch {
    return last;
  }
}

/**
 * "I'm here": checks the player's location with the server, and falls back to
 * a photo check-in when GPS is off or too vague (flagged for review server-side).
 */
export function useCheckIn({ huntId, currentFind, userPos, locationConsent, setError, onArrived }: CheckInInput): CheckIn {
  const findId = currentFind?.id;
  // Keyed by stop, so the offer disappears on its own when the player moves on.
  const [offer, setOffer] = useState<{ findId: string; reason: PhotoCheckInReason } | null>(null);
  const photoCheckIn = offer && offer.findId === findId ? offer.reason : null;

  const handleCheckIn = useCallback(async () => {
    if (!findId) return;
    setError(null);
    try {
      const pos = await freshPosition(locationConsent, userPos);
      const reply = await postJsonStrict<Record<string, unknown>>(`/api/v1/play/${huntId}/arrive`, {
        find_id: findId,
        manual: true,
        ...(pos ? { latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy } : {}),
      });
      const outcome = interpretCheckIn(reply);
      if (outcome.kind === "arrived") {
        setOffer(null);
        onArrived();
      } else if (outcome.kind === "photo") {
        setOffer({ findId, reason: outcome.reason });
      } else {
        setError(outcome.message);
      }
    } catch (err) {
      setError(errorMessage(err, "Failed to record arrival"));
    }
  }, [findId, huntId, locationConsent, userPos, setError, onArrived]);

  const handlePhotoCheckIn = useCallback(
    async (file: File) => {
      if (!findId) return;
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("find_id", findId);
        if (userPos) {
          form.append("latitude", String(userPos.lat));
          form.append("longitude", String(userPos.lng));
          if (userPos.accuracy != null) form.append("accuracy", String(userPos.accuracy));
        }
        await safeFetch(`/api/v1/play/${huntId}/arrive-photo`, { method: "POST", body: form });
        setOffer(null);
        onArrived();
      } catch (err) {
        setError(errorMessage(err, "Failed to upload photo"));
      }
    },
    [findId, huntId, userPos, setError, onArrived]
  );

  const cancelPhotoCheckIn = useCallback(() => setOffer(null), []);

  return { photoCheckIn, handleCheckIn, handlePhotoCheckIn, cancelPhotoCheckIn };
}
