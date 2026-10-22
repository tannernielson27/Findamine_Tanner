import Link from "next/link";
import { ChevronRight, Map as MapIcon } from "lucide-react";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { HuntCard } from "@/components/ui/hunt-card";
import { ExploreControls } from "@/components/explore/explore-controls";
import { ExploreResults } from "@/components/explore/explore-results";
import { ExploreMapView } from "@/components/explore/explore-map-view";
import { AudienceSelect } from "@/components/explore/audience-select";
import {
  ANY_AUDIENCE,
  applyFilters,
  audienceOrFilter,
  audienceSetLabel,
  exploreHref,
  parseFilters,
  popularCampusHunts,
  resolveAudience,
  toExploreHunt,
  type ExploreRow,
} from "@/lib/hunts/explore-filters";
import { withoutMissingColumn } from "@/lib/supabase/without-missing-column";
import { logger } from "@/lib/utils/logger";
import { getBrowseViewer } from "./viewer";

/** The public catalogue is small; filters run on this window. */
const CATALOGUE_LIMIT = 200;
const SEARCH_MAX_LEN = 120;

// cover_image_url arrives with migration 079; until it is applied the query
// retries without it (OPTIONAL_COLUMNS).
const EXPLORE_COLUMNS =
  "id, title, description, cover_image_url, target_audience, play_mode, estimated_duration_min, center_latitude, center_longitude, created_at, subject_domains, finds(deleted_at, tasks(challenge_type)), play_sessions(count)";
const OPTIONAL_COLUMNS = ["cover_image_url"] as const;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function ExplorePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = first(params.q).trim().slice(0, SEARCH_MAX_LEN);
  const filters = parseFilters(params.f);
  const rawAudience = first(params.audience) || null;
  const view = first(params.view) === "map" ? "map" : "list";

  const viewer = await getBrowseViewer();
  const audience = resolveAudience(rawAudience, viewer);

  const supabase = await createSupabaseServiceClient();
  const filterAudience = audienceOrFilter(audience.audiences);
  const run = (columns: string) => {
    let query = supabase
      .from("hunts")
      .select(columns)
      .is("deleted_at", null)
      .eq("is_public", true)
      .in("status", ["published", "enrollment_open"])
      .order("created_at", { ascending: false })
      .limit(CATALOGUE_LIMIT);
    if (q) query = query.textSearch("search_vector", q, { type: "websearch" });
    // Built only from whitelisted audience values (explore-filters).
    if (filterAudience) query = query.or(filterAudience);
    return query;
  };

  // Retries without cover_image_url on a database that doesn't have it yet.
  const { data, error } = await withoutMissingColumn(run, EXPLORE_COLUMNS, OPTIONAL_COLUMNS);
  if (error) logger.error("explore: hunts query failed", { code: error.code, message: error.message });
  const all = ((data ?? []) as unknown as ExploreRow[]).map(toExploreHunt);
  const hunts = applyFilters(all, filters, new Date());
  // Keep the audience the viewer chose (if any) when clearing search + chips.
  const clearHref = exploreHref({ audience: rawAudience });
  const narrowed = !!q || filters.some((f) => f !== "near");
  // One tap past the audience filter when it hides everything.
  const allAgesHref = audience.audiences ? exploreHref({ q, filters, audience: ANY_AUDIENCE }) : null;

  if (view === "map") {
    return (
      <main>
        <h1 className="sr-only">Explore map</h1>
        <ExploreMapView
          hunts={hunts}
          q={q}
          filters={filters}
          audience={rawAudience}
          loadError={!!error}
          allAgesHref={allAgesHref}
        />
      </main>
    );
  }

  const popular = narrowed ? [] : popularCampusHunts(all);

  return (
    <main className="mx-auto w-full max-w-5xl pt-5">
      <header className="flex flex-col gap-3.5 px-5 pb-1.5 sm:px-4">
        <h1 className="font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.1] text-themed-text">Explore</h1>
      </header>

      <div className="px-4">
        <ExploreControls q={q} filters={filters} audience={rawAudience} view="list" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 px-1">
          <AudienceSelect q={q} filters={filters} choice={audience} />
          <Link
            href="/browse/standards"
            className="inline-flex min-h-12 items-center gap-1 text-[15px] font-medium text-link no-underline hover:text-link-dark hover:underline"
          >
            Browse by standard
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {error && (
        <p role="alert" className="mx-4 mt-4 rounded-xl border border-error/30 bg-error/10 px-4 py-3 text-base text-themed-text">
          We couldn&apos;t load hunts right now. Please try again in a moment.
        </p>
      )}

      {popular.length > 0 && (
        <section aria-labelledby="popular-heading" className="mt-4">
          <h2 id="popular-heading" className="mx-5 mb-3 font-[family-name:var(--font-display)] text-[22px] font-semibold text-themed-text">
            Popular at BYU
          </h2>
          <ul className="fm-no-scrollbar flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1" aria-labelledby="popular-heading">
            {popular.map((hunt) => (
              <li key={hunt.id} className="shrink-0 snap-start">
                <HuntCard hunt={hunt} variant="poster" />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mx-4 mt-7">
        <ExploreResults
          hunts={hunts}
          nearOn={filters.includes("near")}
          clearHref={clearHref}
          narrowed={narrowed}
          allAgesHref={allAgesHref}
          audienceLabel={audienceSetLabel(audience.audiences)}
        />
      </div>

      <Link
        href={exploreHref({ q, filters, audience: rawAudience, view: "map" })}
        className="fixed left-1/2 z-30 inline-flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-bold text-white no-underline shadow-[0_8px_20px_rgb(28_36_48/0.28)] transition-colors hover:bg-ink-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 bottom-[calc(var(--fm-tabbar-h)_+_var(--fm-minibar-h)_+_var(--fm-tabbar-gap)_+_30px_+_env(safe-area-inset-bottom))]"
      >
        <MapIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        Map
      </Link>
    </main>
  );
}
