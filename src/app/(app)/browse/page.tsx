import { createSupabaseServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { MapPin, Clock, Users, Search, Compass, ChevronRight } from "lucide-react";
import { AudienceIcon, formatPlayMode } from "./hunt-meta";

export default async function BrowseHuntsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; audience?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createSupabaseServiceClient();

  let query = supabase
    .from("hunts")
    .select("id, title, description, target_audience, play_mode, estimated_duration_min, center_latitude, center_longitude, created_at")
    .is("deleted_at", null)
    .eq("is_public", true)
    .in("status", ["published", "enrollment_open"])
    .order("created_at", { ascending: false })
    .limit(50);

  if (params.q) {
    query = query.textSearch("search_vector", params.q, { type: "websearch" });
  }
  if (params.audience) {
    query = query.or(`target_audience.eq.${params.audience},target_audience.eq.all`);
  }

  const { data: hunts } = await query;

  return (
    <main>
      {/* Compact page header: topo band */}
      <header className="fm-topo border-b border-themed-border">
        <div className="mx-auto max-w-4xl px-4 pt-8 pb-6">
          <h1 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text text-balance">
            <Compass className="w-6 h-6 shrink-0 text-brand-dark" aria-hidden="true" />
            Discover Adventures
          </h1>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {/* Search bar */}
        <form
          role="search"
          className="flex flex-col gap-2 rounded-xl border border-themed-border bg-surface p-2 shadow-[var(--shadow-card)] sm:flex-row"
        >
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-themed-muted"
              aria-hidden="true"
            />
            <input
              name="q"
              type="search"
              defaultValue={params.q}
              aria-label="Search hunts"
              placeholder="Search hunts by name, topic, or location..."
              className="h-11 w-full rounded-lg border border-themed-border bg-themed-bg pl-10 pr-3 text-base text-themed-text placeholder:text-themed-muted transition-colors focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/30"
            />
          </div>
          <div className="flex min-w-0 gap-2">
            <select
              name="audience"
              defaultValue={params.audience}
              aria-label="Audience"
              className="h-11 min-w-0 flex-1 rounded-lg border border-themed-border bg-themed-bg px-3 text-base text-themed-text focus:outline-none focus:ring-2 focus:ring-brand/30 sm:flex-none"
            >
              <option value="">All ages</option>
              <option value="kids">Kids</option>
              <option value="teens">Teens</option>
              <option value="adults">Adults</option>
              <option value="family">Family</option>
            </select>
            <button
              type="submit"
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Search
            </button>
          </div>
        </form>

        {/* Browse by standards link */}
        <div className="mt-2 mb-4 flex justify-end">
          <Link
            href="/browse/standards"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-link transition-colors hover:text-link-dark hover:underline"
          >
            Browse by Standard
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>

        {/* Results */}
        {!hunts || hunts.length === 0 ? (
          <div className="py-16 text-center">
            <p className="mb-2 font-[family-name:var(--font-handwritten)] text-3xl text-themed-muted">
              No adventures found
            </p>
            <p className="text-base text-themed-muted">
              {params.q ? "Try a different search term." : "Check back soon for new hunts!"}
            </p>
          </div>
        ) : (
          <div className="grid gap-3 pb-8 sm:grid-cols-2 lg:grid-cols-3">
            {hunts.map((hunt) => {
              return (
                <Link
                  key={hunt.id}
                  href={`/browse/${hunt.id}`}
                  className="group flex min-w-0 flex-col rounded-xl border border-themed-border bg-surface p-4 shadow-[var(--shadow-card)] transition-colors hover:border-brand/40"
                >
                  {/* Audience pill */}
                  <span className="mb-2 inline-flex items-center gap-1 self-start rounded-full border border-themed-border bg-themed-bg px-2.5 py-0.5 text-sm font-medium capitalize text-themed-muted">
                    <AudienceIcon audience={hunt.target_audience} className="w-3.5 h-3.5 text-secondary" />
                    {hunt.target_audience}
                  </span>

                  <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text text-balance transition-colors group-hover:text-brand-dark">
                    {hunt.title}
                  </h2>
                  {hunt.description && (
                    <p className="mt-1 line-clamp-2 text-sm text-themed-muted">{hunt.description}</p>
                  )}

                  {/* Meta row, set off by a quiet dashed route line */}
                  <div className="mt-auto pt-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-dashed border-themed-border pt-3 text-sm text-themed-muted">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Users className="w-4 h-4 shrink-0 text-secondary" aria-hidden="true" />
                        <span className="truncate">{formatPlayMode(hunt.play_mode)}</span>
                      </span>
                      {hunt.estimated_duration_min && (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap tabular-nums">
                          <Clock className="w-4 h-4 shrink-0 text-secondary" aria-hidden="true" />
                          {hunt.estimated_duration_min} min
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 whitespace-nowrap">
                        <MapPin className="w-4 h-4 shrink-0 text-secondary" aria-hidden="true" />
                        GPS
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
