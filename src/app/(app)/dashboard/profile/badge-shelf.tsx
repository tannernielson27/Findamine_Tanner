"use client";

/* eslint-disable @next/next/no-img-element -- badge icons come from storage with arbitrary sizes */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Award } from "lucide-react";

interface EarnedBadge {
  id: string;
  name: string;
  iconUrl: string | null;
}

/** Narrows GET /api/v1/badges?mine=true rows (user_badges + badge_types embed). */
function toBadges(json: unknown): EarnedBadge[] {
  const rows = (json as { badges?: unknown })?.badges;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const r = row as { id?: unknown; badge_types?: { name?: unknown; icon_url?: unknown } | null };
    const name = r.badge_types?.name;
    if (typeof r.id !== "string" || typeof name !== "string") return [];
    return [{ id: r.id, name, iconUrl: typeof r.badge_types?.icon_url === "string" ? r.badge_types.icon_url : null }];
  });
}

const SHOWN = 8;

/** Horizontal shelf of the player's newest badges, linking to /dashboard/badges. */
export function BadgeShelf() {
  const [badges, setBadges] = useState<EarnedBadge[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/badges?mine=true")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => !cancelled && setBadges(toBadges(json)))
      .catch(() => !cancelled && setBadges([]));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="profile-badges" className="mt-7">
      <div className="flex items-baseline justify-between gap-3 px-1 pb-3">
        <h2 id="profile-badges" className="m-0 font-[family-name:var(--font-display)] text-[22px] font-semibold">
          Badges
        </h2>
        <Link href="/dashboard/badges" className="inline-flex min-h-11 items-center text-[15px] font-semibold text-link no-underline hover:text-link-dark">
          See all
        </Link>
      </div>
      {badges === null ? (
        <div className="fm-shimmer flex gap-3 overflow-hidden" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex w-[84px] shrink-0 flex-col items-center gap-2">
              <div className="h-16 w-16 rounded-full bg-divider" />
              <div className="h-3.5 w-14 rounded bg-divider" />
            </div>
          ))}
        </div>
      ) : badges.length === 0 ? (
        <Link
          href="/dashboard/badges"
          className="flex min-h-16 items-center gap-3.5 rounded-card border border-themed-border bg-surface p-4 text-themed-text no-underline hover:bg-themed-bg"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-juniper-tint text-juniper" aria-hidden="true">
            <Award className="h-6 w-6" />
          </span>
          <span className="text-base text-themed-muted">Finish a hunt to earn your first badge. See what you can unlock.</span>
        </Link>
      ) : (
        <ul className="fm-no-scrollbar m-0 flex list-none gap-3 overflow-x-auto p-0 pb-1">
          {badges.slice(0, SHOWN).map((b) => (
            <li key={b.id} className="flex w-[84px] shrink-0 flex-col items-center gap-2 text-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full border border-themed-border bg-surface" aria-hidden="true">
                {b.iconUrl ? <img src={b.iconUrl} alt="" className="h-9 w-9" /> : <Award className="h-7 w-7 text-juniper" />}
              </span>
              <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-themed-text">{b.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
