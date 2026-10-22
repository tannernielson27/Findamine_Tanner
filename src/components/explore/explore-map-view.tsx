"use client";

/**
 * Explore map: full-bleed Google map with a pin per hunt centre, floating
 * search + chips, the viewer's dot (only if location is already granted or
 * they tapped "Near me"), and a draggable results sheet.
 *
 * The Maps key is referrer-restricted, so the map can fail to load (local
 * dev, a blocked network). Then a plain panel says so and the sheet still
 * lists every hunt, so nothing depends on the map rendering.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { GoogleMap, MarkerF } from "@react-google-maps/api";
import { List, MapPinOff } from "lucide-react";
import { useGoogleMaps } from "@/components/maps/use-google-maps";
import { HuntCard } from "@/components/ui/hunt-card";
import { exploreHref, withDistances, type ExploreHunt, type FilterId } from "@/lib/hunts/explore-filters";
import { ExploreControls } from "./explore-controls";
import { useSilentLocation } from "./explore-location";
import { ResultsSheet } from "./results-sheet";

interface ExploreMapViewProps {
  hunts: ExploreHunt[];
  q: string;
  filters: FilterId[];
  audience: string | null;
  /** The hunts query failed (shown as an alert instead of an empty map). */
  loadError?: boolean;
}

/** Fewer chips over the map so the map stays visible (mockup: ExploreMap). */
const MAP_CHIPS: readonly FilterId[] = ["near", "short", "campus", "team"];

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

function hasCoords(h: ExploreHunt): h is ExploreHunt & { latitude: number; longitude: number } {
  return h.latitude != null && h.longitude != null;
}

export function ExploreMapView({ hunts, q, filters, audience, loadError = false }: ExploreMapViewProps) {
  const { isLoaded, unavailableReason } = useGoogleMaps();
  const origin = useSilentLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [bounds, setBounds] = useState<google.maps.LatLngBounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** What the view was last framed for, so a late location fix or re-render doesn't undo the player's pan/zoom. */
  const framedFor = useRef<string | null>(null);

  const nearOn = filters.includes("near");
  const located = useMemo(() => withDistances(hunts, origin, nearOn), [hunts, origin, nearOn]);
  const pinned = useMemo(() => located.filter(hasCoords), [located]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Frame the pins once per result set (or on the player once "Near me" has a fix).
  const frameOrigin = nearOn ? origin : null;
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
    if (map) setBounds(map.getBounds() ?? null);
  }, [map]);

  // No map: list every hunt. Before the first idle: every hunt that has a pin.
  const inArea = unavailableReason
    ? located
    : bounds
      ? pinned.filter((h) => bounds.contains({ lat: h.latitude, lng: h.longitude }))
      : pinned;
  const selected = located.find((h) => h.id === selectedId) ?? inArea[0] ?? located[0] ?? null;
  const rest = inArea.filter((h) => h.id !== selected?.id);
  const count = inArea.length;

  const listPill = (
    <Link
      href={exploreHref({ q, filters, audience, view: "list" })}
      className="inline-flex h-11 items-center gap-2 rounded-full bg-surface px-4 text-[15px] font-bold text-themed-text no-underline shadow-[0_6px_16px_rgb(28_36_48/0.18)] transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <List className="h-[18px] w-[18px]" aria-hidden="true" />
      List
    </Link>
  );

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100dvh-var(--fm-header-h,64px))] min-h-[520px] overflow-hidden bg-map-ground"
    >
      {unavailableReason ? (
        <div role="alert" className="flex h-full flex-col items-center gap-3 px-8 pt-[180px] text-center">
          <MapPinOff className="h-8 w-8 text-themed-muted" aria-hidden="true" />
          <p className="text-base text-themed-text">{unavailableReason}</p>
          <p className="text-base text-themed-muted">Every hunt is still listed below.</p>
        </div>
      ) : !isLoaded ? (
        <div className="fm-shimmer h-full" aria-hidden="true" />
      ) : (
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
            const isSel = h.id === selected?.id;
            return (
              <MarkerF
                key={h.id}
                position={{ lat: h.latitude, lng: h.longitude }}
                title={isSel ? `${h.title} (selected)` : h.title}
                zIndex={isSel ? 10 : 1}
                onClick={() => setSelectedId(h.id)}
                icon={isSel ? icons?.selected : icons?.idle}
              />
            );
          })}
          {origin && (
            <MarkerF
              position={origin}
              title="Your location"
              zIndex={20}
              clickable={false}
              icon={icons?.me}
            />
          )}
        </GoogleMap>
      )}

      <div className="absolute inset-x-0 top-0 z-10 flex flex-col gap-3 px-4 pt-4">
        <ExploreControls q={q} filters={filters} audience={audience} view="map" floating chips={MAP_CHIPS} />
        {loadError && (
          <p role="alert" className="rounded-xl bg-surface px-4 py-3 text-base text-themed-text shadow-raised">
            We couldn&apos;t load hunts right now. Please try again in a moment.
          </p>
        )}
      </div>

      {height > 0 && (
        <ResultsSheet
          containerHeight={height}
          title={`${count} ${count === 1 ? "hunt" : "hunts"} in this area`}
          subtitle={nearOn && origin ? "Sorted by distance" : undefined}
          above={listPill}
          header={selected ? <HuntCard hunt={selected} variant="row" /> : <NoHuntsHere />}
        >
          {rest.map((h) => (
            <HuntCard key={h.id} hunt={h} variant="row" />
          ))}
        </ResultsSheet>
      )}
    </div>
  );
}

function NoHuntsHere() {
  return (
    <p className="rounded-[18px] border border-dashed border-themed-border bg-surface px-4 py-5 text-base text-themed-muted">
      No hunts match here. Zoom out, or clear a chip.
    </p>
  );
}
