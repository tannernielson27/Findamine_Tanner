"use client";

import { useRef, useState } from "react";
import { GoogleMap, MarkerF, InfoWindow } from "@react-google-maps/api";
import { useGoogleMaps } from "@/components/maps/use-google-maps";

interface Stop {
  order: number;
  name: string;
  lat: number;
  lng: number;
}

interface HuntMapProps {
  centerLat: number | null;
  centerLng: number | null;
  stops: Stop[];
}

const MAP_STYLES = { width: "100%", height: "280px" };

// Marker colors (Google Maps needs raw hex): sky pin for the hunt center,
// trail-blaze for stops. The legend dots reuse these so they always match.
const CENTER_FILL = "#1A6FA6";
const CENTER_STROKE = "#145782";
const STOP_FILL = "#C2410C";
const STOP_STROKE = "#9A3412";

export default function HuntMap({ centerLat, centerLng, stops }: HuntMapProps) {
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);

  const { isLoaded, unavailableReason } = useGoogleMaps();

  // If no stops with coordinates and no center, don't render
  if (stops.length === 0 && !centerLat) return null;

  // Calculate bounds to fit all markers
  const allPoints = [
    ...(centerLat && centerLng ? [{ lat: centerLat, lng: centerLng }] : []),
    ...stops.map((s) => ({ lat: s.lat, lng: s.lng })),
  ];

  if (allPoints.length === 0) return null;

  // Default center: hunt center or first stop
  const defaultCenter = centerLat && centerLng
    ? { lat: centerLat, lng: centerLng }
    : { lat: allPoints[0].lat, lng: allPoints[0].lng };

  function handleLoad(map: google.maps.Map) {
    mapRef.current = map;

    if (allPoints.length > 1) {
      const bounds = new google.maps.LatLngBounds();
      allPoints.forEach((p) => bounds.extend(p));
      map.fitBounds(bounds, 40);
    }
  }

  if (unavailableReason) {
    return (
      <div role="alert" className="mb-6 rounded-xl border border-themed-border bg-themed-bg px-4 py-3 text-sm text-themed-muted">
        {unavailableReason}
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="mb-6 rounded-xl border border-themed-border bg-themed-bg" style={MAP_STYLES}>
        <div className="flex h-full items-center justify-center text-sm text-themed-muted">
          Loading map...
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)]">
      <GoogleMap
        mapContainerStyle={MAP_STYLES}
        center={defaultCenter}
        zoom={14}
        onLoad={handleLoad}
        options={{
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        }}
      >
        {/* Hunt center marker (sky pin) */}
        {centerLat && centerLng && (
          <MarkerF
            position={{ lat: centerLat, lng: centerLng }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: CENTER_FILL,
              fillOpacity: 0.8,
              strokeColor: CENTER_STROKE,
              strokeWeight: 2,
            }}
            title="Hunt center"
            onClick={() => setSelectedStop(null)}
          />
        )}

        {/* Stop markers (trail-blaze, numbered) */}
        {stops.map((stop) => (
          <MarkerF
            key={stop.order}
            position={{ lat: stop.lat, lng: stop.lng }}
            label={{
              text: String(stop.order),
              color: "white",
              fontSize: "12px",
              fontWeight: "bold",
            }}
            icon={{
              path: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z",
              fillColor: STOP_FILL,
              fillOpacity: 0.9,
              strokeColor: STOP_STROKE,
              strokeWeight: 1,
              scale: 1.5,
              anchor: new google.maps.Point(12, 24),
              labelOrigin: new google.maps.Point(12, 9),
            }}
            onClick={() => setSelectedStop(stop)}
          />
        ))}

        {/* Info window for selected stop */}
        {selectedStop && (
          <InfoWindow
            position={{ lat: selectedStop.lat, lng: selectedStop.lng }}
            onCloseClick={() => setSelectedStop(null)}
          >
            <div className="text-sm text-themed-text">
              <p className="font-semibold">Stop {selectedStop.order}</p>
              <p className="text-themed-muted">{selectedStop.name}</p>
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-themed-border bg-themed-bg px-3 py-2 text-sm text-themed-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CENTER_FILL }} aria-hidden="true" />
          Hunt center
        </span>
        <span className="flex items-center gap-1.5 tabular-nums">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: STOP_FILL }} aria-hidden="true" />
          Stops ({stops.length})
        </span>
      </div>
    </div>
  );
}
