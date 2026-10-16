import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Clock, Flag, Play, ShieldCheck, Users } from "lucide-react";
import Leaderboard from "@/components/social/leaderboard";
import HuntAnalytics from "@/components/hunts/hunt-analytics";
import HuntRating from "@/components/hunts/hunt-rating";
import HuntMap from "@/components/hunts/hunt-map";
import { StopList } from "@/components/hunts/stop-detail-modal";
import HuntTeamPanel from "@/components/teams/hunt-team-panel";
import { AudienceIcon, formatPlayMode } from "../hunt-meta";
import { canAccessHunt, isPubliclyAvailable } from "@/lib/hunts/review";
import { SafetyTipList } from "@/components/play/safety-tips";

const PILL_CLASS =
  "inline-flex items-center gap-1.5 rounded-full border border-themed-border bg-surface px-3 py-1 text-sm text-themed-text";

const PLAYABLE_STATUSES = ["published", "enrollment_open", "in_progress"];

export default async function HuntDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServiceClient();

  const { data: hunt } = await supabase
    .from("hunts")
    .select("*, finds(id, sort_order, deleted_at, clue_text, clue_hints, locations(name, latitude, longitude, radius_meters), tasks(title, challenge_type), primers(title, content))")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!hunt) notFound();

  // Same statuses the play API accepts (play/[huntId]/start).
  const isPlayable = PLAYABLE_STATUSES.includes(hunt.status);
  // Every play_mode except "solo" is a team mode (team_self_select, team_assigned, ...).
  const isTeamHunt = typeof hunt.play_mode === "string" && hunt.play_mode.startsWith("team_");

  // Only hunts approved in publish review are public. Drafts are visible to
  // their owner and reviewers; published-but-unapproved hunts also to the
  // creator's roster students. Same rule as the hunts API (canAccessHunt).
  if (!isPubliclyAvailable(hunt)) {
    const authClient = await createSupabaseServerClient();
    const { data: { user: authUser } } = await authClient.auth.getUser();
    const { data: viewer } = authUser
      ? await supabase
          .from("users")
          .select("id, role")
          .eq("auth_id", authUser.id)
          .is("deleted_at", null)
          .maybeSingle()
      : { data: null };

    const canPreview = await canAccessHunt(supabase, hunt, viewer);
    if (!canPreview) notFound();
  }

  // Removed stops are soft-deleted.
  const finds = (hunt.finds || [])
    .filter((f: { deleted_at: string | null }) => !f.deleted_at)
    .sort((a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order);

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
        {isPlayable && isTeamHunt ? (
          // Team hunts: the panel offers Start only once the player is on a
          // team (the start API itself would let a teamless player play solo).
          <HuntTeamPanel huntId={hunt.id} playHref={`/play/${hunt.id}`} />
        ) : isPlayable ? (
          <Link
            href={`/play/${hunt.id}`}
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto"
          >
            <Play className="w-5 h-5" aria-hidden="true" />
            Start Hunt
          </Link>
        ) : (
          <p className="rounded-lg border border-themed-border bg-themed-bg px-4 py-3 text-base text-themed-muted">
            {hunt.status === "draft"
              ? "This hunt is still a draft. Publish it before anyone can play."
              : "This hunt has ended and can no longer be played."}
          </p>
        )}
      </header>

      {/* Location play happens in the real world (App Store 1.4.5). */}
      <section
        aria-labelledby="play-safely-heading"
        className="mb-6 rounded-xl border border-themed-border bg-themed-bg p-4"
      >
        <h2
          id="play-safely-heading"
          className="mb-2 inline-flex items-center gap-2 font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text"
        >
          <ShieldCheck className="h-5 w-5 text-secondary" aria-hidden="true" />
          Play safely
        </h2>
        <SafetyTipList />
      </section>

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
