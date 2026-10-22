"use client";

import Link from "next/link";
import { Navigation2 } from "lucide-react";
import type { ActiveHunt } from "@/lib/play/active-hunt";
import { activeHuntLabels } from "@/lib/play/active-hunt-labels";

/**
 * Active-hunt "now playing" bar (Explore.dc.html): ink, 64px, sits 12px above
 * the tab bar. The whole bar is one link back into the hunt.
 */
export default function MiniBar({ hunt }: { hunt: ActiveHunt }) {
  const { stopLabel: stops, shortActionLabel } = activeHuntLabels(hunt);
  return (
    <Link
      href={hunt.href}
      aria-label={`${shortActionLabel} ${hunt.title}, ${stops.toLowerCase()}`}
      className="fixed inset-x-4 bottom-[calc(var(--fm-tabbar-gap)+var(--fm-tabbar-h)+12px+env(safe-area-inset-bottom))] z-40 mx-auto flex h-[var(--fm-minibar-h)] max-w-md items-center gap-3 rounded-[20px] bg-ink py-0 pl-3.5 pr-2 text-white no-underline shadow-[0_8px_24px_rgb(28_36_48/0.22)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 lg:bottom-[calc(24px+env(safe-area-inset-bottom))]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand" aria-hidden="true">
        <Navigation2 className="h-5 w-5" strokeWidth={2.2} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-bold">{hunt.title}</span>
        <span className="text-[13px] text-on-ink-muted">{stops}</span>
      </span>
      <span className="flex h-11 shrink-0 items-center rounded-[14px] bg-white/15 px-4 text-[15px] font-bold" aria-hidden="true">
        {shortActionLabel}
      </span>
    </Link>
  );
}
