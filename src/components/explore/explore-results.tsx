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

interface ExploreResultsProps {
  hunts: ExploreHunt[];
  nearOn: boolean;
  /** Link that clears search and chips (keeps the audience). */
  clearHref: string;
  /** True when a search or chip narrowed the list. */
  narrowed: boolean;
}

export function ExploreResults({ hunts, nearOn, clearHref, narrowed }: ExploreResultsProps) {
  const origin = useSilentLocation();
  const list = withDistances(hunts, origin, nearOn);
  const sortedByDistance = nearOn && !!origin;

  return (
    <section aria-labelledby="all-hunts-heading" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id="all-hunts-heading" className="font-[family-name:var(--font-display)] text-[22px] font-semibold text-themed-text">
          {sortedByDistance ? "All hunts nearby" : "All hunts"}
        </h2>
        <span className="shrink-0 text-[15px] tabular-nums text-themed-muted" aria-live="polite">
          {list.length} {list.length === 1 ? "result" : "results"}
        </span>
      </div>

      {list.length === 0 ? (
        <EmptyState narrowed={narrowed} clearHref={clearHref} />
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

function EmptyState({ narrowed, clearHref }: { narrowed: boolean; clearHref: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-themed-border bg-surface px-6 py-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-light text-brand-dark">
        <SearchX className="h-7 w-7" aria-hidden="true" />
      </span>
      <p className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text">
        {narrowed ? "No hunts match these filters" : "No hunts here yet"}
      </p>
      <p className="max-w-xs text-base text-themed-muted">
        {narrowed
          ? "Try fewer chips or a shorter search. Each chip you add narrows the list further."
          : "New hunts are added often. Try a different audience, or check back soon."}
      </p>
      {narrowed && (
        <Link
          href={clearHref}
          className="inline-flex min-h-12 items-center justify-center rounded-[14px] bg-ink px-5 text-base font-bold text-white no-underline transition-colors hover:bg-ink-raised"
        >
          Clear filters
        </Link>
      )}
    </div>
  );
}
