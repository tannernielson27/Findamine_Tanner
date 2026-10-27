"use client";

import { GoogleMap, CircleF, MarkerF } from "@react-google-maps/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGoogleMaps } from "./use-google-maps";

interface NavigateMapProps {
  /** Target location center */
  targetLat: number;
  targetLng: number;
  /** Arrival radius in meters */
  radiusMeters: number;
  /** Current user position (null = waiting for GPS) */
  userLat: number | null;
  userLng: number | null;
  /** Hot/cold zone for coloring */
  zone: string | null;
}

const ZONE_COLORS: Record<string, string> = {
  icy: "#3B82F6",
  cold: "#60A5FA",
  warm: "#F59E0B",
  hot: "#F97316",
  burning: "#EF4444",
};

// Module-level so the objects keep one identity: @react-google-maps/api re-applies
// options/styles to the map whenever the reference changes, i.e. on every GPS fix.
const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  zoomControl: true,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  styles: [
    // Subtle map style — reduce visual noise
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ],
};

const TARGET_CIRCLE_OPTIONS: google.maps.CircleOptions = {
  fillColor: "#10B981",
  fillOpacity: 0.15,
  strokeColor: "#10B981",
  strokeWeight: 2,
  strokeOpacity: 0.5,
};

const containerStyle = { width: "100%", height: "280px", borderRadius: "12px" };

export default function NavigateMap({
  targetLat,
  targetLng,
  radiusMeters,
  userLat,
  userLng,
  zone,
}: NavigateMapProps) {
  const { isLoaded, unavailableReason } = useGoogleMaps();

  const [map, setMap] = useState<google.maps.Map | null>(null);
  // Which target the view was last framed for, so we frame once per stop
  // instead of yanking the map back on every GPS fix.
  const framedFor = useRef<string | null>(null);

  const onLoad = useCallback((map: google.maps.Map) => {
    setMap(map);
  }, []);

  const hasUser = userLat != null && userLng != null;
  const target = useMemo(() => ({ lat: targetLat, lng: targetLng }), [targetLat, targetLng]);

  // Frame the player and the target together on the first fix for each stop.
  // After that the player is free to pan and zoom; "Recenter" re-frames on demand.
  const frame = useCallback(() => {
    if (!map) return;
    if (userLat == null || userLng == null) {
      map.panTo(target);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    bounds.extend(target);
    bounds.extend({ lat: userLat, lng: userLng });
    map.fitBounds(bounds, 48);
  }, [map, target, userLat, userLng]);

  useEffect(() => {
    if (!map || !hasUser) return;
    const key = `${targetLat},${targetLng}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    frame();
  }, [map, hasUser, targetLat, targetLng, frame]);

  const zoneColor = zone ? ZONE_COLORS[zone] || "#6B7280" : "#6B7280";
  const userPosition = useMemo(
    () => (userLat != null && userLng != null ? { lat: userLat, lng: userLng } : null),
    [userLat, userLng]
  );
  const userIcon = useMemo<google.maps.Symbol | undefined>(
    () =>
      isLoaded
        ? {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 10,
            fillColor: zoneColor,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 3,
          }
        : undefined,
    [isLoaded, zoneColor]
  );

  if (unavailableReason) {
    return (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
        {unavailableReason} You can still follow the clue to find this stop.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div style={containerStyle} className="bg-gray-100 fm-shimmer flex items-center justify-center">
        <span className="text-sm text-gray-500">Loading map...</span>
      </div>
    );
  }

  return (
    <div className="relative">
      <GoogleMap
        mapContainerStyle={containerStyle}
        center={target}
        zoom={16}
        onLoad={onLoad}
        options={MAP_OPTIONS}
      >
        {/* Target area circle */}
        <CircleF
          center={target}
          radius={radiusMeters}
          options={TARGET_CIRCLE_OPTIONS}
        />

        {/* User position marker */}
        {userPosition && (
          <MarkerF
            position={userPosition}
            icon={userIcon}
          />
        )}
      </GoogleMap>

      {hasUser && (
        <button
          type="button"
          onClick={frame}
          className="absolute left-2 top-2 rounded-md bg-white/95 px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow hover:bg-white"
        >
          Recenter
        </button>
      )}
    </div>
  );
}
