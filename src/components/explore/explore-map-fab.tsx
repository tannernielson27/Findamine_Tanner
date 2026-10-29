"use client";

/**
 * Floating "Map" pill for the Explore list on phones. It takes the slot just
 * above the tab bar, which is where the active-hunt mini-bar sits, so it hides
 * whenever the mini-bar shows: the list header's inline Map link is always
 * there (see ExploreMapLink), and three stacked floating layers covered too
 * much of a phone screen. Desktop has no tab bar and uses the inline link only.
 */
import Link from "next/link";
import { Map as MapIcon } from "lucide-react";
import { useShellActiveHunt } from "@/components/layout/active-hunt-context";

export function ExploreMapFab({ href }: { href: string }) {
  const { hunt } = useShellActiveHunt();
  if (hunt) return null;
  return (
    <Link
      href={href}
      className="fixed bottom-[calc(var(--fm-tabbar-gap)_+_var(--fm-tabbar-h)_+_12px_+_env(safe-area-inset-bottom))] left-1/2 z-30 inline-flex h-12 -translate-x-1/2 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-bold text-white no-underline shadow-[0_8px_20px_rgb(28_36_48/0.28)] transition-colors hover:bg-ink-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 lg:hidden"
    >
      <MapIcon className="h-[18px] w-[18px]" aria-hidden="true" />
      Map
    </Link>
  );
}

/** Inline "Map" toggle for the "All hunts" header row; always visible. */
export function ExploreMapLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-themed-border bg-surface px-4 text-[15px] font-semibold text-themed-text no-underline transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
    >
      <MapIcon className="h-4 w-4" aria-hidden="true" />
      Map
    </Link>
  );
}
