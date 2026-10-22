/**
 * Hunt card in the four layouts the overhaul uses:
 * - "full":   Explore list. 168px cover, title + rating, icon stats row.
 * - "shelf":  Home "Near you" carousel. 236px wide, 120px cover.
 * - "poster": Explore shelves. 160px square cover, text below, no box.
 * - "row":    Map sheet preview. 88px thumbnail beside the text.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Clock, Flag, MapPin, Star, User, Users } from "lucide-react";
import { TopoCover, toneForHunt } from "@/components/ui/topo-cover";
import { Tag } from "@/components/ui/chip";
import { audienceLabel, cardStats, formatDistance, shortPlayMode, type HuntCardData } from "@/lib/hunts/card-data";
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
  const stats = cardStats(hunt);

  if (variant === "poster") {
    return (
      <Link href={link} className={cn("flex w-40 shrink-0 snap-start flex-col gap-2 text-themed-text no-underline", className)}>
        <TopoCover tone={tone} imageUrl={hunt.coverImageUrl} alt="" className="h-40 rounded-2xl" />
        <span className="font-[family-name:var(--font-display)] text-[17px] font-semibold leading-tight">{hunt.title}</span>
        <span className="-mt-1 text-sm text-themed-muted">{stats.filter((s) => !s.endsWith("mi") && !s.endsWith("ft")).slice(0, 2).join(" · ")}</span>
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
          <span className="text-sm text-themed-muted">{stats.slice(0, 3).join(" · ")}</span>
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
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold leading-tight">{hunt.title}</span>
          <span className="text-sm text-themed-muted">{stats.filter((s) => s !== dist).join(" · ")}</span>
          {dist && <span className="text-sm font-semibold text-juniper">{dist} from you</span>}
        </span>
        <ChevronRight className="h-5 w-5 self-center text-themed-muted" aria-hidden="true" />
      </Link>
    );
  }

  const dist = formatDistance(hunt.distanceMeters);
  const mode = shortPlayMode(hunt.playMode);
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
        <ul className="flex flex-wrap gap-x-3.5 gap-y-1 text-sm text-themed-muted" aria-label="Hunt details">
          {dist && <Stat icon={<MapPin className="h-4 w-4" aria-hidden="true" />}>{dist}</Stat>}
          {hunt.stopCount ? <Stat icon={<Flag className="h-4 w-4" aria-hidden="true" />}>{hunt.stopCount} stops</Stat> : null}
          {hunt.durationMinutes ? <Stat icon={<Clock className="h-4 w-4" aria-hidden="true" />}>{hunt.durationMinutes} min</Stat> : null}
          {mode && (
            <Stat icon={mode === "Team" ? <Users className="h-4 w-4" aria-hidden="true" /> : <User className="h-4 w-4" aria-hidden="true" />}>{mode}</Stat>
          )}
        </ul>
      </div>
    </Link>
  );
}

function Stat({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-[5px] tabular-nums">
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
