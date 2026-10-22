"use client";

import NavigateMap from "@/components/maps/navigate-map";
import { useGoogleMaps } from "@/components/maps/use-google-maps";
import type { Find } from "@/lib/play/play-types";
import type { UserPosition } from "@/lib/play/use-geo-tracking";

interface PlayMapProps {
  location: Find["locations"];
  userPos: UserPosition | null;
  zone: string | null;
}

/**
 * NavigateMap stretched to fill the screen behind the HUD. NavigateMap sizes
 * itself to a 280px card, so the wrapper overrides its container height and
 * radius, and moves its "Recenter" button to the right edge, clear of the HUD
 * and the thumb zone. Without a map (no key, load error, no location) the
 * plain map-ground colour shows instead; the clue and "I'm here" still work.
 */
export function PlayMap({ location, userPos, zone }: PlayMapProps) {
  const { unavailableReason } = useGoogleMaps();

  return (
    <div
      className={[
        "absolute inset-0 bg-map-ground",
        "[&>div]:!h-full [&>div]:!rounded-none [&>div>div:first-child]:!h-full [&>div>div:first-child]:!rounded-none",
        "[&>div>button]:!left-auto [&>div>button]:!right-4 [&>div>button]:!top-1/2 [&>div>button]:!min-h-11",
        "[&>div>button]:!rounded-full [&>div>button]:!px-4 [&>div>button]:!text-[15px] [&>div>button]:!font-semibold",
        "[&>div>button]:!text-ink [&>div>button]:!shadow-raised",
      ].join(" ")}
    >
      {location && !unavailableReason && (
        <NavigateMap
          targetLat={location.latitude}
          targetLng={location.longitude}
          radiusMeters={location.radius_meters || 50}
          userLat={userPos?.lat ?? null}
          userLng={userPos?.lng ?? null}
          zone={zone}
        />
      )}
    </div>
  );
}
