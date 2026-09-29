import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Flag, Play, Users } from "lucide-react";
import Leaderboard from "@/components/social/leaderboard";
import HuntAnalytics from "@/components/hunts/hunt-analytics";
import HuntRating from "@/components/hunts/hunt-rating";
import HuntMap from "@/components/hunts/hunt-map";
import { StopList } from "@/components/hunts/stop-detail-modal";
import { AudienceIcon, formatPlayMode } from "../hunt-meta";

const PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-themed-border bg-surface px-3 py-1 text-sm text-themed-text";

export default async function HuntDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServiceClient();

  const { data: hunt } = await supabase
    .from("hunts")
    .select("*, finds(id, sort_order, clue_text, clue_hints, locations(name, latitude, longitude, radius_meters), tasks(title, challenge_type), primers(title, content))")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!hunt) notFound();

  const finds = (hunt.finds || []).sort(
    (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <Link
        href="/browse"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-link transition-colors hover:text-link-dark hover:underline"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
        Back to browse
      </Link>

      <header className="mb-6">
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text text-balance sm:text-3xl">
          {hunt.title}
        </h1>

        {hunt.description && (
          <p className="mb-4 text-base text-themed-muted">{hunt.description}</p>
        )}

        <ul className="mb-5 flex flex-wrap gap-2" aria-label="Hunt details">
          <li className={`${PILL_CLASS} capitalize`}>
            <AudienceIcon audience={hunt.target_audience} className="w-4 h-4 text-secondary" />
            {hunt.target_audience}
          </li>
          <li className={PILL_CLASS}>
            <Users className="w-4 h-4 text-secondary" aria-hidden="true" />
            {formatPlayMode(hunt.play_mode)}
          </li>
          {hunt.estimated_duration_min && (
            <li className={`${PILL_CLASS} tabular-nums`}>
              <Clock className="w-4 h-4 text-secondary" aria-hidden="true" />
              ~{hunt.estimated_duration_min} min
            </li>
          )}
          <li className={`${PILL_CLASS} tabular-nums`}>
            <Flag className="w-4 h-4 text-secondary" aria-hidden="true" />
            {finds.length} stop{finds.length !== 1 ? "s" : ""}
          </li>
        </ul>

        {/* The screen's one primary action */}
        <Link
          href={`/play/${hunt.id}`}
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto"
        >
          <Play className="w-5 h-5" aria-hidden="true" />
          Start Hunt
        </Link>
      </header>

      {/* Hunt map */}
      <HuntMap
        centerLat={hunt.center_latitude}
        centerLng={hunt.center_longitude}
        stops={finds.map((f: { sort_order: number; locations: { name: string; latitude: number; longitude: number } | null }) => ({
          order: f.sort_order + 1,
          name: (f.locations as { name: string } | null)?.name || `Stop ${f.sort_order + 1}`,
          lat: (f.locations as { latitude: number } | null)?.latitude || 0,
          lng: (f.locations as { longitude: number } | null)?.longitude || 0,
        })).filter((s: { lat: number; lng: number }) => s.lat !== 0 && s.lng !== 0)}
      />

      {finds.length > 0 && (
        <section aria-labelledby="stops-heading" className="mb-8">
          <h2 id="stops-heading" className="mb-2 font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text">
            Stops — click for details
          </h2>
          <StopList finds={finds} />
        </section>
      )}

      {/* Hunt rating */}
      <HuntRating huntId={hunt.id} />

      {/* Hunt performance analytics */}
      <HuntAnalytics huntId={hunt.id} />

      {/* Live leaderboard for this hunt */}
      <div className="mt-4">
        <Leaderboard huntId={hunt.id} />
      </div>
    </main>
  );
}
