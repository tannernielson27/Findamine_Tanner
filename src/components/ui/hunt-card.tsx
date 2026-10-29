/**
 * Hunt card in the four layouts the overhaul uses:
 * - "full":   Explore list. 168px cover, title + rating, stats row.
 * - "shelf":  Home "Near you" carousel. 236px wide, 120px cover.
 * - "poster": Explore shelves. Square cover (160px on phones, fills its
 *             column from sm up), text below, no box.
 * - "row":    Map sheet preview. 88px thumbnail beside the text.
 *
 * Every variant shows the same icon stats row (HuntStats), so a hunt reads
 * the same on Home, Explore and the map.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Clock, Flag, MapPin, Star, User, Users } from "lucide-react";
import { TopoCover, toneForHunt } from "@/components/ui/topo-cover";
import { Tag } from "@/components/ui/chip";
import { audienceLabel, formatDistance, shortPlayMode, type HuntCardData } from "@/lib/hunts/card-data";
import { cn } from "@/lib/utils/cn";

export type HuntCardVariant = "full" | "shelf" | "poster" | "row";

interface HuntCardProps {
  hunt: HuntCardData;
  variant?: HuntCardVariant;
  href?: string;
  className?: string;
}

const TAG_TEXT = { blaze: "text-brand-dark", juniper: "text-juniper", sky: "text-link" } as const;

export function HuntCard({ hunt, variant = "full", href, className }: HuntCardProps) {
  const link = href ?? `/browse/${hunt.id}`;
  const tone = toneForHunt(hunt.id, hunt.title);
  const tag = audienceLabel(hunt.audience);

  if (variant === "poster") {
    // The title always reserves two lines, so every tile's stats row starts at the same height.
    return (
      <Link href={link} className={cn("flex w-40 shrink-0 snap-start flex-col gap-2 text-themed-text no-underline sm:w-full", className)}>
        <TopoCover tone={tone} imageUrl={hunt.coverImageUrl} alt="" className="aspect-square w-full rounded-2xl" />
        <span className="line-clamp-2 min-h-[2.5em] font-[family-name:var(--font-display)] text-[17px] font-semibold leading-tight">
          {hunt.title}
        </span>
        <HuntStats hunt={hunt} compact withDistance={false} className="-mt-1" />
      </Link>
    );
  }

  if (variant === "shelf") {
    return (
      <Link
        href={link}
        className={cn("flex w-[236px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-themed-border bg-surface text-themed-text no-underline", className)}
      >
        <TopoCover tone={tone} imageUrl={hunt.coverImageUrl} className="h-[120px]">
          {tag && <Tag tone="glass" className={cn("absolute left-2.5 top-2.5", TAG_TEXT[tone])}>{tag}</Tag>}
        </TopoCover>
        <div className="flex flex-col gap-1.5 px-3.5 pb-3.5 pt-3">
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold leading-tight">{hunt.title}</span>
          <HuntStats hunt={hunt} compact />
        </div>
      </Link>
    );
  }

  if (variant === "row") {
    const dist = formatDistance(hunt.distanceMeters);
    return (
      <Link
        href={link}
        className={cn("flex gap-3 rounded-[18px] border border-themed-border bg-surface p-2.5 text-themed-text no-underline", className)}
      >
        <TopoCover tone={tone} imageUrl={hunt.coverImageUrl} className="h-[88px] w-[88px] shrink-0 rounded-xl" />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold leading-tight">{hunt.title}</span>
          <HuntStats hunt={hunt} compact withDistance={false} />
          {dist && <span className="text-sm font-semibold text-juniper">{dist} from you</span>}
        </div>
        <ChevronRight className="h-5 w-5 self-center text-themed-muted" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <Link
      href={link}
      className={cn("flex flex-col overflow-hidden rounded-card border border-themed-border bg-surface text-themed-text no-underline transition-shadow duration-200 hover:shadow-float", className)}
    >
      <TopoCover tone={tone} imageUrl={hunt.coverImageUrl} className="h-[168px]">
        {tag && <Tag tone="glass" className="absolute left-3 top-3">{tag}</Tag>}
      </TopoCover>
      <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-[family-name:var(--font-display)] text-xl font-semibold leading-tight">{hunt.title}</span>
          {hunt.rating != null && (
            <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold tabular-nums">
              <Star className="h-[15px] w-[15px] fill-brand text-brand" aria-hidden="true" />
              {hunt.rating.toFixed(1)}
            </span>
          )}
        </div>
        <HuntStats hunt={hunt} />
      </div>
    </Link>
  );
}

interface HuntStatsProps {
  hunt: HuntCardData;
  /** Smaller icons and gaps for the narrow card layouts. */
  compact?: boolean;
  /** False where the card shows distance elsewhere (row) or not at all (poster). */
  withDistance?: boolean;
  className?: string;
}

/** The stats row every card uses: distance, stops, minutes, play mode, each with its icon. */
function HuntStats({ hunt, compact = false, withDistance = true, className }: HuntStatsProps) {
  const dist = withDistance ? formatDistance(hunt.distanceMeters) : null;
  const mode = shortPlayMode(hunt.playMode);
  if (!dist && !hunt.stopCount && !hunt.durationMinutes && !mode) return null;
  const iconClass = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <ul
      className={cn("m-0 flex list-none flex-wrap gap-y-1 p-0 text-sm text-themed-muted", compact ? "gap-x-2.5" : "gap-x-3.5", className)}
      aria-label="Hunt details"
    >
      {dist && <Stat compact={compact} icon={<MapPin className={iconClass} aria-hidden="true" />}>{dist}</Stat>}
      {hunt.stopCount ? (
        <Stat compact={compact} icon={<Flag className={iconClass} aria-hidden="true" />}>
          {hunt.stopCount} {hunt.stopCount === 1 ? "stop" : "stops"}
        </Stat>
      ) : null}
      {hunt.durationMinutes ? (
        <Stat compact={compact} icon={<Clock className={iconClass} aria-hidden="true" />}>{hunt.durationMinutes} min</Stat>
      ) : null}
      {mode && (
        <Stat
          compact={compact}
          icon={mode === "Team" ? <Users className={iconClass} aria-hidden="true" /> : <User className={iconClass} aria-hidden="true" />}
        >
          {mode}
        </Stat>
      )}
    </ul>
  );
}

function Stat({ icon, compact, children }: { icon: ReactNode; compact: boolean; children: ReactNode }) {
  return (
    <li className={cn("inline-flex items-center tabular-nums", compact ? "gap-1" : "gap-[5px]")}>
      {icon}
      {children}
    </li>
  );
}

/** Placeholder matching the "full" card exactly, for loading states. */
export function HuntCardSkeleton() {
  return (
    <div className="fm-shimmer flex flex-col overflow-hidden rounded-card border border-themed-border bg-surface" aria-hidden="true">
      <div className="h-[168px] bg-divider" />
      <div className="flex flex-col gap-2 px-4 pb-4 pt-3.5">
        <div className="h-6 w-2/3 rounded-md bg-divider" />
        <div className="h-4 w-1/2 rounded-md bg-divider" />
      </div>
    </div>
  );
}
