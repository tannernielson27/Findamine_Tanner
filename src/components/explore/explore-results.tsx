"use client";

/**
 * "All hunts" list. Adds distances when the viewer's position is known and
 * sorts nearest first when "Near me" is on. Position never leaves the device.
 */
import Link from "next/link";
import { SearchX } from "lucide-react";
import { HuntCard } from "@/components/ui/hunt-card";
import { withDistances, type ExploreHunt } from "@/lib/hunts/explore-filters";
import { useSilentLocation } from "./explore-location";
import { ExploreMapLink } from "./explore-map-fab";

interface ExploreResultsProps {
  hunts: ExploreHunt[];
  nearOn: boolean;
  /** Link that clears search and chips (keeps the audience). */
  clearHref: string;
  /** True when a search or chip narrowed the list. */
  narrowed: boolean;
  /** Same search + chips for every age, or null when no audience filter is on. */
  allAgesHref: string | null;
  /** The audience filter in effect, e.g. "Adults & families". */
  audienceLabel: string;
  /** Same search in map view; shown as a Map toggle beside the count. */
  mapHref?: string | null;
}

export function ExploreResults({ hunts, nearOn, clearHref, narrowed, allAgesHref, audienceLabel, mapHref = null }: ExploreResultsProps) {
  const origin = useSilentLocation();
  const list = withDistances(hunts, origin, nearOn);
  const sortedByDistance = nearOn && !!origin;

  return (
    <section aria-labelledby="all-hunts-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 id="all-hunts-heading" className="font-[family-name:var(--font-display)] text-[22px] font-semibold text-themed-text">
          {sortedByDistance ? "All hunts nearby" : "All hunts"}
        </h2>
        <div className="flex shrink-0 items-center gap-3">
          <span className="text-[15px] tabular-nums text-themed-muted" aria-live="polite">
            {list.length} {list.length === 1 ? "result" : "results"}
          </span>
          {/* Nothing to map on an empty list. */}
          {mapHref && list.length > 0 && <ExploreMapLink href={mapHref} />}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState narrowed={narrowed} clearHref={clearHref} allAgesHref={allAgesHref} audienceLabel={audienceLabel} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" aria-labelledby="all-hunts-heading">
          {list.map((hunt) => (
            <li key={hunt.id} className="min-w-0">
              <HuntCard hunt={hunt} variant="full" className="h-full" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const ACTION_BASE =
  "inline-flex min-h-12 items-center justify-center rounded-[14px] px-5 text-base font-bold no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";
const PRIMARY_ACTION = `${ACTION_BASE} bg-ink text-white hover:bg-ink-raised`;
const SECONDARY_ACTION = `${ACTION_BASE} border border-themed-border bg-surface text-themed-text hover:bg-themed-bg`;

interface EmptyStateProps {
  narrowed: boolean;
  clearHref: string;
  allAgesHref: string | null;
  audienceLabel: string;
}

function EmptyState({ narrowed, clearHref, allAgesHref, audienceLabel }: EmptyStateProps) {
  const body = narrowed
    ? "Try fewer chips or a shorter search. Each chip you add narrows the list further."
    : allAgesHref
      ? `Nothing for ${audienceLabel.toLowerCase()} yet. Hunts for other ages may still suit you.`
      : "New hunts are added often. Check back soon.";
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-themed-border bg-surface px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light text-brand-dark">
        <SearchX className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text">
        {narrowed ? "No hunts match these filters" : "No hunts here yet"}
      </p>
      <p className="max-w-xs text-base text-themed-muted">{body}</p>
      {(allAgesHref || narrowed) && (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-3">
          {allAgesHref && (
            <Link
              href={allAgesHref}
              className={PRIMARY_ACTION}
            >
              Show all ages
            </Link>
          )}
          {narrowed && (
            <Link
              href={clearHref}
              className={allAgesHref ? SECONDARY_ACTION : PRIMARY_ACTION}
            >
              Clear filters
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
