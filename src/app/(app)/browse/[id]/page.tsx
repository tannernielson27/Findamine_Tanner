import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck, Star } from "lucide-react";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import Leaderboard from "@/components/social/leaderboard";
import HuntAnalytics from "@/components/hunts/hunt-analytics";
import HuntRating from "@/components/hunts/hunt-rating";
import HuntMap from "@/components/hunts/hunt-map";
import { StopList } from "@/components/hunts/stop-detail-modal";
import HuntTeamPanel from "@/components/teams/hunt-team-panel";
import { SafetyTipList } from "@/components/play/safety-tips";
import { TopoCover, toneForHunt } from "@/components/ui/topo-cover";
import { IconLink } from "@/components/ui/icon-button";
import { Tag } from "@/components/ui/chip";
import { ShareButton } from "@/components/explore/share-button";
import { StatRow } from "@/components/explore/stat-row";
import { StartMapPreview } from "@/components/explore/start-map-preview";
import { ChallengeChips, DetailSection, subjectLabel } from "@/components/explore/hunt-detail-parts";
import { canAccessHunt, isPubliclyAvailable, isReviewer } from "@/lib/hunts/review";
import { audienceLabel, shortPlayMode } from "@/lib/hunts/card-data";
import { isCampusHunt } from "@/lib/hunts/explore-filters";
import { formatPlayMode } from "../hunt-meta";
import { getBrowseViewer } from "../viewer";
import { DetailCtaBar } from "./detail-cta-bar";
import { getHuntSocialProof, liveFinds, startArea, challengeTypesOf, type DetailFind } from "./detail-data";

const PLAYABLE_STATUSES = ["published", "enrollment_open", "in_progress"];

export default async function HuntDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServiceClient();

  // `*` includes cover_image_url once migration 079 is applied.
  const { data: hunt } = await supabase
    .from("hunts")
    .select("*, finds(id, sort_order, deleted_at, clue_text, clue_hints, locations(name, latitude, longitude, radius_meters), tasks(title, challenge_type), primers(title, content))")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!hunt) notFound();

  const viewer = await getBrowseViewer();

  // Only hunts approved in publish review are public. Drafts are visible to
  // their owner and reviewers; published-but-unapproved hunts also to the
  // creator's roster students. Same rule as the hunts API (canAccessHunt).
  const isPublic = isPubliclyAvailable(hunt);
  if (!isPublic && !(await canAccessHunt(supabase, hunt, viewer))) notFound();

  // Same statuses the play API accepts (play/[huntId]/start).
  const isPlayable = PLAYABLE_STATUSES.includes(hunt.status);
  // Every play_mode except "solo" is a team mode (team_self_select, team_assigned, ...).
  const isTeamHunt = typeof hunt.play_mode === "string" && hunt.play_mode.startsWith("team_");
  // Clues, stop names and the full route are spoilers: only the hunt's owner
  // and reviewers see them here. Everyone else sees the start area only.
  const canSeeStops = !!viewer && (viewer.id === hunt.created_by || isReviewer(viewer.role));

  const finds = liveFinds(hunt.finds as DetailFind[] | null);
  const start = startArea(finds, hunt.center_latitude, hunt.center_longitude);
  const social = await getHuntSocialProof(supabase, hunt.id, hunt.created_by);
  const tags = [
    audienceLabel(hunt.target_audience),
    ...((hunt.subject_domains as string[] | null) ?? []).map(subjectLabel),
    isCampusHunt({ title: hunt.title, description: hunt.description, tags: [] }) ? "Campus" : null,
  ].filter((t): t is string => !!t);
  const metaBits = [
    social.plays > 0 ? `${social.plays} ${social.plays === 1 ? "play" : "plays"}` : null,
    social.byFindamine ? "by Findamine" : null,
  ].filter(Boolean);

  return (
    // Clears the CTA bar, which is taller when it shows a note and a Sign in button.
    <main
      className={
        !viewer && !isPlayable
          ? "pb-[calc(156px+env(safe-area-inset-bottom))]"
          : "pb-[calc(104px+env(safe-area-inset-bottom))]"
      }
    >
      <TopoCover
        tone={toneForHunt(hunt.id, hunt.title)}
        imageUrl={hunt.cover_image_url ?? null}
        alt=""
        className="h-[300px]"
      >
        <div className="absolute inset-x-4 top-4 flex justify-between">
          <IconLink href="/browse" label="Back to Explore" tone="floating">
            <ArrowLeft className="h-[22px] w-[22px]" strokeWidth={2.2} aria-hidden="true" />
          </IconLink>
          <ShareButton title={hunt.title} path={`/browse/${hunt.id}`} />
        </div>
      </TopoCover>

      <div className="relative mx-auto -mt-7 flex max-w-3xl flex-col gap-[22px] rounded-t-[28px] bg-themed-bg px-5 pt-6">
        <header className="flex flex-col gap-2.5">
          {tags.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Tags">
              {tags.map((t, i) => (
                <li key={`${t}-${i}`}>
                  <Tag tone={i === 0 ? "blaze" : "neutral"}>{t}</Tag>
                </li>
              ))}
            </ul>
          )}
          <h1 className="font-[family-name:var(--font-display)] text-[32px] font-semibold leading-[1.1] text-themed-text text-balance">
            {hunt.title}
          </h1>
          {(social.rating || metaBits.length > 0) && (
            <p className="flex flex-wrap items-center gap-2 text-[15px] text-themed-muted">
              {social.rating && (
                <>
                  <Star className="h-4 w-4 fill-brand text-brand" aria-hidden="true" />
                  <span>
                    <strong className="text-themed-text tabular-nums">{social.rating.toFixed(1)}</strong>
                    <span className="sr-only"> out of 5 stars</span>
                  </span>
                </>
              )}
              {metaBits.length > 0 && <span>{social.rating ? "· " : ""}{metaBits.join(" · ")}</span>}
            </p>
          )}
        </header>

        <StatRow
          stops={finds.length}
          minutes={hunt.estimated_duration_min ?? null}
          mode={shortPlayMode(hunt.play_mode)}
          start={start ? { lat: start.lat, lng: start.lng } : null}
        />

        {!isPublic && <ReviewNote status={hunt.status} reviewStatus={hunt.review_status} />}

        {isPlayable && isTeamHunt && viewer && (
          <div id="team" className="scroll-mt-6 [&>*]:rounded-[18px]">
            {/* Team hunts: the panel offers Start only once the player is on a team. */}
            <HuntTeamPanel huntId={hunt.id} playHref={`/play/${hunt.id}`} />
          </div>
        )}

        {hunt.description && (
          <DetailSection id="about-heading" title="About">
            <p className="text-base leading-[1.55] text-themed-text">{hunt.description}</p>
            {isTeamHunt && <p className="text-[15px] text-themed-muted">Play mode: {formatPlayMode(hunt.play_mode)}</p>}
          </DetailSection>
        )}

        {start && (
          <DetailSection
            id="start-heading"
            title="Where it starts"
            note={<p className="text-sm text-themed-muted">Later stops stay hidden until you reach them.</p>}
          >
            <StartMapPreview lat={start.lat} lng={start.lng} radiusMeters={start.radius} />
          </DetailSection>
        )}

        {challengeTypesOf(finds).length > 0 && (
          <DetailSection id="do-heading" title="What you'll do">
            <ChallengeChips types={challengeTypesOf(finds)} />
          </DetailSection>
        )}

        {canSeeStops && finds.length > 0 && (
          <DetailSection
            id="stops-heading"
            title="All stops"
            note={<p className="text-sm text-themed-muted">Only you and reviewers see the route and clues. Players see the start area.</p>}
          >
            <div className="[&>div]:mb-0 [&>div]:rounded-[18px] [&>div]:shadow-none">
              <HuntMap
                centerLat={hunt.center_latitude}
                centerLng={hunt.center_longitude}
                stops={finds
                  .map((f) => ({
                    order: f.sort_order + 1,
                    name: f.locations?.name || `Stop ${f.sort_order + 1}`,
                    lat: f.locations?.latitude || 0,
                    lng: f.locations?.longitude || 0,
                  }))
                  .filter((s) => s.lat !== 0 && s.lng !== 0)}
              />
            </div>
            <StopList finds={finds} />
          </DetailSection>
        )}

        <div className="[&>div]:rounded-[18px] [&>div]:shadow-none">
          <Leaderboard huntId={hunt.id} />
        </div>

        <HuntRating huntId={hunt.id} />

        {/* Location play happens in the real world (App Store 1.4.5). */}
        <section aria-labelledby="play-safely-heading" className="rounded-[18px] border border-themed-border bg-surface p-4">
          <h2
            id="play-safely-heading"
            className="mb-2 inline-flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text"
          >
            <ShieldCheck className="h-5 w-5 text-juniper" aria-hidden="true" />
            Play safely
          </h2>
          <SafetyTipList />
        </section>

        <div className="empty:hidden [&>section]:mt-0 [&>section]:rounded-[18px] [&>section]:shadow-none">
          <HuntAnalytics huntId={hunt.id} />
        </div>
      </div>

      <DetailCtaBar huntId={hunt.id} status={hunt.status} playable={isPlayable} teamHunt={isTeamHunt} signedIn={!!viewer} />
    </main>
  );
}

function ReviewNote({ status, reviewStatus }: { status: string; reviewStatus: string | null }) {
  const text =
    status === "draft"
      ? "Draft: only you and reviewers can see this hunt."
      : reviewStatus === "rejected"
        ? "Reviewers didn't approve this hunt, so only its creator and reviewers can open it."
        : "Not listed yet: this hunt is waiting for review. Its creator, reviewers and the creator's students can open it.";
  return (
    <p role="note" className="rounded-[18px] border border-themed-border bg-sky-tint px-4 py-3 text-[15px] text-themed-text">
      {text}
    </p>
  );
}
