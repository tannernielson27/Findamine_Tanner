"use client";

/**
 * Explore search field + filter chips. All state lives in the URL
 * (lib/hunts/explore-filters), so results are shareable and back-button safe.
 *
 * "Near me" needs the viewer's position: tapping it is the only thing on
 * Explore that asks for location, and it goes through the permission primer
 * first (App Store 5.1.1). The search is a plain GET form, so it also works
 * before hydration; search itself stays server-side full-text.
 */
import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { FilterChip } from "@/components/ui/chip";
import { Button } from "@/components/ui/button";
import { PermissionPrimer } from "@/components/permissions/permission-primer";
import {
  FILTER_IDS,
  FILTER_LABELS,
  exploreHref,
  serializeFilters,
  toggleFilter,
  type FilterId,
} from "@/lib/hunts/explore-filters";
import { cn } from "@/lib/utils/cn";
import { requestExploreLocation, useExploreOrigin } from "./explore-location";

interface ExploreControlsProps {
  q: string;
  filters: FilterId[];
  /** Raw `?audience=` value, carried through searches and chip changes. */
  audience: string | null;
  view: "list" | "map";
  /** Map view: controls float over the map with shadows instead of borders. */
  floating?: boolean;
  /** Chips to show (the map shows fewer to keep the map visible). */
  chips?: readonly FilterId[];
}

type NearState = "idle" | "primer" | "locating" | "failed";

export function ExploreControls({ q, filters, audience, view, floating = false, chips = FILTER_IDS }: ExploreControlsProps) {
  const router = useRouter();
  const origin = useExploreOrigin();
  const [pending, startTransition] = useTransition();
  const [near, setNear] = useState<NearState>("idle");

  function go(nextFilters: FilterId[]) {
    startTransition(() => {
      router.push(exploreHref({ q, filters: nextFilters, audience, view }), { scroll: false });
    });
  }

  function onChip(id: FilterId) {
    const turningOnNear = id === "near" && !filters.includes("near");
    if (turningOnNear && !origin) {
      setNear("primer");
      return;
    }
    go(toggleFilter(filters, id));
  }

  async function locate() {
    setNear("locating");
    try {
      await requestExploreLocation();
      setNear("idle");
      if (!filters.includes("near")) go(toggleFilter(filters, "near"));
    } catch {
      setNear("failed");
    }
  }

  // Soft navigation keeps the in-memory location; the GET action is the no-JS fallback.
  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = new FormData(e.currentTarget).get("q");
    const nextQ = typeof value === "string" ? value : "";
    startTransition(() => {
      router.push(exploreHref({ q: nextQ, filters, audience, view }), { scroll: false });
    });
  }

  const needsLocation = filters.includes("near") && !origin && near === "idle";
  const searchId = view === "map" ? "explore-map-search" : "explore-search";
  const f = serializeFilters(filters);

  return (
    <div className="flex flex-col gap-3.5">
      <form
        role="search"
        action="/browse"
        method="get"
        onSubmit={onSearch}
        className={cn(
          "flex h-[52px] items-center gap-2.5 rounded-full bg-surface px-[18px] focus-within:ring-2 focus-within:ring-brand/40",
          floating ? "shadow-raised" : "border border-themed-border shadow-[0_2px_8px_rgb(28_36_48/0.05)]"
        )}
      >
        <Search className="h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
        <label htmlFor={searchId} className="sr-only">
          {view === "map" ? "Search this area" : "Search hunts"}
        </label>
        <input
          id={searchId}
          name="q"
          type="search"
          defaultValue={q}
          enterKeyHint="search"
          placeholder={view === "map" ? "Search this area" : "Search hunts, places, topics"}
          className="h-full min-w-0 flex-1 bg-transparent text-base text-themed-text placeholder:text-themed-muted focus:outline-none"
        />
        {f && <input type="hidden" name="f" value={f} />}
        {audience && <input type="hidden" name="audience" value={audience} />}
        {view === "map" && <input type="hidden" name="view" value="map" />}
      </form>

      <div
        role="group"
        aria-label="Filters"
        aria-busy={pending || undefined}
        className={cn("fm-no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1.5", pending && "opacity-80")}
      >
        {chips.map((id) => (
          <FilterChip key={id} selected={filters.includes(id)} onToggle={() => onChip(id)} floating={floating}>
            {FILTER_LABELS[id]}
          </FilterChip>
        ))}
      </div>

      {needsLocation && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-themed-border bg-surface px-4 py-2">
          <p className="text-base text-themed-text">Near me needs your location to sort by distance.</p>
          <Button variant="ink" onClick={() => setNear("primer")}>Use my location</Button>
        </div>
      )}

      {near !== "idle" && (
        <div className={cn(floating && "rounded-card bg-themed-bg p-1 shadow-float")} aria-live="polite">
          {near === "primer" && (
            <PermissionPrimer
              kind="location"
              onContinue={locate}
              deniedActions={
                <Button variant="secondary" onClick={() => setNear("idle")}>
                  Show hunts without distance
                </Button>
              }
            />
          )}
          {near === "locating" && (
            <p role="status" className="rounded-xl border border-themed-border bg-surface px-4 py-3 text-base text-themed-muted">
              Finding your location…
            </p>
          )}
          {near === "failed" && (
            <div role="alert" className="flex flex-col gap-3 rounded-xl border border-themed-border bg-surface p-4">
              <p className="text-base text-themed-text">
                We couldn&apos;t get your location. Check that location is on, or browse without distance.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="ink" onClick={locate}>Try again</Button>
                <Button variant="secondary" onClick={() => setNear("idle")}>Not now</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
