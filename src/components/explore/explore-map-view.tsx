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
import dynamic from "next/dynamic";
import Link from "next/link";
import { List } from "lucide-react";
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
  /** Same search + chips for every age, or null when no audience filter is on. */
  allAgesHref?: string | null;
}

/** Fewer chips over the map so the map stays visible (mockup: ExploreMap). */
const MAP_CHIPS: readonly FilterId[] = ["near", "short", "campus", "team"];


// Google Maps (and @react-google-maps/api) load as their own chunk; the
// controls and results sheet render without waiting for it.
const ExploreMapCanvas = dynamic(() => import("./explore-map-canvas"), {
  ssr: false,
  loading: () => <div className="fm-shimmer h-full" aria-hidden="true" />,
});

function hasCoords(h: ExploreHunt): h is ExploreHunt & { latitude: number; longitude: number } {
  return h.latitude != null && h.longitude != null;
}

export function ExploreMapView({ hunts, q, filters, audience, loadError = false, allAgesHref = null }: ExploreMapViewProps) {
  const origin = useSilentLocation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const [bounds, setBounds] = useState<google.maps.LatLngBounds | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const frameOrigin = nearOn ? origin : null;
  const handleUnavailable = useCallback((u: boolean) => setMapUnavailable(u), []);

  // No map: list every hunt. Before the first idle: every hunt that has a pin.
  const inArea = mapUnavailable
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
    // data-fm-full-bleed: the app shell drops its tab-bar padding for this view
    // (globals.css), so map + sheet exactly fill the viewport under the top
    // bar and the tab bar floats over the sheet.
    <div
      ref={containerRef}
      data-fm-full-bleed=""
      className="relative h-[calc(100dvh-var(--fm-header-h,65px))] min-h-[520px] overflow-hidden bg-map-ground"
    >
      <ExploreMapCanvas
        pinned={pinned}
        selectedId={selected?.id ?? null}
        origin={origin}
        frameOrigin={frameOrigin}
        onSelect={setSelectedId}
        onBoundsChange={setBounds}
        onUnavailableChange={handleUnavailable}
      />

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
          header={
            selected ? (
              <HuntCard hunt={selected} variant="row" />
            ) : (
              <NoHuntsHere allAgesHref={located.length === 0 ? allAgesHref : null} />
            )
          }
        >
          {rest.map((h) => (
            <HuntCard key={h.id} hunt={h} variant="row" />
          ))}
        </ResultsSheet>
      )}
    </div>
  );
}

function NoHuntsHere({ allAgesHref }: { allAgesHref: string | null }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-[18px] border border-dashed border-themed-border bg-surface px-4 py-5">
      <p className="text-base text-themed-muted">
        {allAgesHref ? "No hunts for this audience yet." : "No hunts match here. Zoom out, or clear a chip."}
      </p>
      {allAgesHref && (
        <Link
          href={allAgesHref}
          className="inline-flex min-h-12 items-center justify-center rounded-[14px] bg-ink px-5 text-base font-bold text-white no-underline transition-colors hover:bg-ink-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Show all ages
        </Link>
      )}
    </div>
  );
}
