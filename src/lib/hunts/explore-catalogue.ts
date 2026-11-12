import { unstable_cache } from "next/cache";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { withoutMissingColumn } from "@/lib/supabase/without-missing-column";
import type { ExploreRow } from "./explore-filters";

/**
 * The Explore catalogue is the same for every viewer with the same search and
 * audience, and it was the most expensive query under study-scale load, so it
 * is cached briefly. New or edited hunts appear within this window.
 */
export const EXPLORE_CACHE_SECONDS = 60;

/** The public catalogue is small; filters run on this window. */
const CATALOGUE_LIMIT = 200;

// cover_image_url arrives with migration 079; until it is applied the query
// retries without it (OPTIONAL_COLUMNS).
const EXPLORE_COLUMNS =
  "id, title, description, cover_image_url, target_audience, play_mode, estimated_duration_min, center_latitude, center_longitude, created_at, subject_domains, finds(deleted_at, tasks(challenge_type)), play_sessions(count)";
const OPTIONAL_COLUMNS = ["cover_image_url"] as const;

export interface CatalogueError {
  code?: string;
  message: string;
}

export interface CatalogueResult {
  rows: ExploreRow[];
  error: CatalogueError | null;
}

/** Thrown inside the cached function so a failed query is never stored. */
class CatalogueQueryError extends Error {
  constructor(public readonly detail: CatalogueError) {
    super(detail.message);
  }
}

async function queryCatalogue(q: string, audienceFilter: string | null): Promise<ExploreRow[]> {
  const supabase = await createSupabaseServiceClient();
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
    if (audienceFilter) query = query.or(audienceFilter);
    return query;
  };
  const { data, error } = await withoutMissingColumn(run, EXPLORE_COLUMNS, OPTIONAL_COLUMNS);
  if (error) throw new CatalogueQueryError({ code: error.code ?? undefined, message: error.message });
  return (data ?? []) as unknown as ExploreRow[];
}

const cachedCatalogue = unstable_cache(queryCatalogue, ["explore-catalogue-v1"], {
  revalidate: EXPLORE_CACHE_SECONDS,
  tags: ["explore-catalogue"],
});

/** Public Explore rows for a search + audience filter (cached; never throws). */
export async function loadExploreCatalogue(q: string, audienceFilter: string | null): Promise<CatalogueResult> {
  try {
    return { rows: await cachedCatalogue(q, audienceFilter), error: null };
  } catch (err) {
    if (err instanceof CatalogueQueryError) return { rows: [], error: err.detail };
    return { rows: [], error: { message: err instanceof Error ? err.message : "Unknown error" } };
  }
}
