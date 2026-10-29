"use client";

/**
 * "Where it starts": a small, static-feeling map of the start area only.
 * Later stops are never passed to this component, so they can't leak.
 * Falls back to plain topo art when Google Maps can't load.
 */
import { useMemo } from "react";
import { GoogleMap, CircleF } from "@react-google-maps/api";
import { useGoogleMaps } from "@/components/maps/use-google-maps";

interface StartMapPreviewProps {
  lat: number;
  lng: number;
  /** Radius of the start area circle, metres. */
  radiusMeters: number;
}

// Raw colour for Google Maps: trail orange (design token --color-brand on the adult band).
const TRAIL = "#C2410C";

const OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  clickableIcons: false,
  gestureHandling: "none",
  keyboardShortcuts: false,
  styles: [
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ],
};

export function StartMapPreview({ lat, lng, radiusMeters }: StartMapPreviewProps) {
  const { isLoaded, unavailableReason } = useGoogleMaps();
  const center = useMemo(() => ({ lat, lng }), [lat, lng]);

  return (
    <div
      role="img"
      aria-label="Map of the area where this hunt starts"
      className="relative h-[150px] overflow-hidden rounded-[18px] border border-themed-border bg-map-ground"
    >
      {isLoaded && !unavailableReason ? (
        <GoogleMap mapContainerClassName="absolute inset-0" center={center} zoom={16} options={OPTIONS}>
          <CircleF
            center={center}
            radius={radiusMeters}
            options={{
              fillColor: TRAIL,
              fillOpacity: 0.14,
              strokeColor: TRAIL,
              strokeWeight: 2,
              clickable: false,
            }}
          />
        </GoogleMap>
      ) : (
        <div className="fm-cover-juniper absolute inset-0" aria-hidden="true">
          <span className="absolute left-1/2 top-[40%] h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-brand bg-brand/15" />
        </div>
      )}
      {/* Top-left: Google's terms forbid covering the logo in the bottom-left corner. */}
      <span className="absolute top-3 left-3 rounded-full bg-white/95 px-3 py-1.5 text-[13px] font-semibold text-themed-text">
        Start area
      </span>
    </div>
  );
}
