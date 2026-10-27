"use client";

/**
 * The Google-Maps-dependent half of the explore map (script loader, pins,
 * framing). Split out so @react-google-maps/api loads as its own chunk after
 * the controls and results sheet have rendered; ExploreMapView loads it with
 * next/dynamic.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, MarkerF } from "@react-google-maps/api";
import { MapPinOff } from "lucide-react";
import { useGoogleMaps } from "@/components/maps/use-google-maps";

// Google Maps needs raw colours: ink for idle pins, trail orange for the
// selected one, sky for the viewer (same values as the design tokens).
const INK = "#1C2430";
const TRAIL = "#C2410C";
const SKY = "#1A6FA6";
const PIN_PATH = "M12 23s8-6.8 8-13a8 8 0 0 0-16 0c0 6.2 8 13 8 13z";
/** Rough centre of BYU campus, used only when no hunt has coordinates. */
const FALLBACK_CENTER = { lat: 40.2518, lng: -111.6493 };

const MAP_OPTIONS: google.maps.MapOptions = {
  disableDefaultUI: true,
  clickableIcons: false,
  gestureHandling: "greedy",
  styles: [
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
  ],
};

export interface PinnedHunt {
  id: string;
  title: string;
  latitude: number;
  longitude: number;
}

interface ExploreMapCanvasProps {
  pinned: PinnedHunt[];
  selectedId: string | null;
  origin: { lat: number; lng: number } | null;
  /** Set when "Near me" is on and has a fix: frame the player instead of the pins. */
  frameOrigin: { lat: number; lng: number } | null;
  onSelect: (id: string) => void;
  onBoundsChange: (bounds: google.maps.LatLngBounds | null) => void;
  /** Reports whether the map can't render (blocked key, offline), so the list can show every hunt. */
  onUnavailableChange: (unavailable: boolean) => void;
}

export default function ExploreMapCanvas({
  pinned,
  selectedId,
  origin,
  frameOrigin,
  onSelect,
  onBoundsChange,
  onUnavailableChange,
}: ExploreMapCanvasProps) {
  const { isLoaded, unavailableReason } = useGoogleMaps();
  const [map, setMap] = useState<google.maps.Map | null>(null);
  /** What the view was last framed for, so a late location fix or re-render doesn't undo the player's pan/zoom. */
  const framedFor = useRef<string | null>(null);

  const unavailable = !!unavailableReason;
  useEffect(() => {
    onUnavailableChange(unavailable);
  }, [unavailable, onUnavailableChange]);

  // Frame the pins once per result set (or on the player once "Near me" has a fix).
  const pinKey = pinned.map((h) => h.id).join(",");
  useEffect(() => {
    if (!map) return;
    const key = frameOrigin ? `near:${frameOrigin.lat},${frameOrigin.lng}` : `pins:${pinKey}`;
    if (framedFor.current === key) return;
    framedFor.current = key;
    if (frameOrigin) {
      map.setCenter(frameOrigin);
      map.setZoom(14);
      return;
    }
    if (pinned.length === 0) return;
    if (pinned.length === 1) {
      map.setCenter({ lat: pinned[0].latitude, lng: pinned[0].longitude });
      map.setZoom(15);
      return;
    }
    const b = new google.maps.LatLngBounds();
    pinned.forEach((h) => b.extend({ lat: h.latitude, lng: h.longitude }));
    // Leave room for the controls on top and the collapsed sheet below.
    map.fitBounds(b, { top: 150, bottom: 320, left: 40, right: 40 });
  }, [map, pinned, pinKey, frameOrigin]);

  // Two pin icons, built once the API is loaded (a fresh icon per render resets every marker).
  const icons = useMemo(() => {
    if (!isLoaded || unavailableReason) return null;
    const pin = (fill: string, size: number, stroke: number): google.maps.Symbol => ({
      path: PIN_PATH,
      fillColor: fill,
      fillOpacity: 1,
      strokeColor: "#FFFFFF",
      strokeWeight: stroke,
      scale: size / 24,
      anchor: new google.maps.Point(12, 23),
    });
    return {
      idle: pin(INK, 40, 1.6),
      selected: pin(TRAIL, 56, 1.4),
      me: {
        path: google.maps.SymbolPath.CIRCLE,
        scale: 9,
        fillColor: SKY,
        fillOpacity: 1,
        strokeColor: "#FFFFFF",
        strokeWeight: 4,
      } as google.maps.Symbol,
    };
  }, [isLoaded, unavailableReason]);

  const onIdle = useCallback(() => {
    if (map) onBoundsChange(map.getBounds() ?? null);
  }, [map, onBoundsChange]);

  if (unavailableReason) {
    return (
      <div role="alert" className="flex h-full flex-col items-center gap-3 px-8 pt-[180px] text-center">
        <MapPinOff className="h-8 w-8 text-themed-muted" aria-hidden="true" />
        <p className="text-base text-themed-text">{unavailableReason}</p>
        <p className="text-base text-themed-muted">Every hunt is still listed below.</p>
      </div>
    );
  }
  if (!isLoaded) return <div className="fm-shimmer h-full" aria-hidden="true" />;

  return (
    <GoogleMap
      mapContainerClassName="absolute inset-0"
      center={FALLBACK_CENTER}
      zoom={14}
      options={MAP_OPTIONS}
      onLoad={setMap}
      onUnmount={() => setMap(null)}
      onIdle={onIdle}
    >
      {pinned.map((h) => {
        const isSel = h.id === selectedId;
        return (
          <MarkerF
            key={h.id}
            position={{ lat: h.latitude, lng: h.longitude }}
            title={isSel ? `${h.title} (selected)` : h.title}
            zIndex={isSel ? 10 : 1}
            onClick={() => onSelect(h.id)}
            icon={isSel ? icons?.selected : icons?.idle}
          />
        );
      })}
      {origin && (
        <MarkerF position={origin} title="Your location" zIndex={20} clickable={false} icon={icons?.me} />
      )}
    </GoogleMap>
  );
}
