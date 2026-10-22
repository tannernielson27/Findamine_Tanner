"use client";

import { Compass, Navigation2 } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { ProgressSegments } from "@/components/ui/progress";
import { useShellActiveHunt } from "@/components/layout/active-hunt-context";
import { stopLine } from "@/components/layout/mini-bar";
import { timeAgo } from "./home-data";

/**
 * Top of Home: the hunt in progress (Main.dc.html dark card), or, when there
 * is none, a light card whose one primary action opens Explore. Either way
 * this is the screen's single trail-orange button.
 */
export function ResumeCard() {
  const { hunt, loading } = useShellActiveHunt();

  if (loading) return <ResumeCardSkeleton />;

  if (!hunt) {
    return (
      <section aria-labelledby="home-next-hunt" className="mx-4 flex flex-col gap-4 rounded-card border border-themed-border bg-surface p-5">
        <div className="flex items-start gap-3.5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-dark" aria-hidden="true">
            <Compass className="h-6 w-6" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h2 id="home-next-hunt" className="m-0 font-[family-name:var(--font-display)] text-[22px] font-semibold leading-tight">
              Find your next hunt
            </h2>
            <p className="m-0 text-base text-themed-muted">Pick a trail nearby, follow the clues, and score points at every stop.</p>
          </div>
        </div>
        <ButtonLink href="/browse" size="lg" block>
          Explore hunts
        </ButtonLink>
      </section>
    );
  }

  const last = timeAgo(hunt.lastActiveAt);
  const detail = last ? `last played ${last}` : "pick up where you left off";

  return (
    <section aria-label="Hunt in progress" className="mx-4 overflow-hidden rounded-card bg-ink text-white shadow-[0_10px_30px_rgb(28_36_48/0.18)]">
      <div className="fm-cover-ink relative h-[76px]">
        <span className="absolute left-5 top-[18px] inline-flex items-center gap-1.5 rounded-full bg-white/[0.12] px-2.5 py-1.5 text-[13px] font-semibold tracking-[0.02em]">
          <span className="h-2 w-2 rounded-full bg-on-ink-accent" aria-hidden="true" />
          IN PROGRESS
        </span>
      </div>
      <div className="flex flex-col gap-3.5 px-5 pb-5 pt-1">
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-[family-name:var(--font-display)] text-2xl font-semibold">{hunt.title}</h2>
          <span className="text-base text-on-ink-muted">
            {stopLine(hunt)} · {detail}
          </span>
        </div>
        {hunt.totalStops > 0 && (
          <ProgressSegments total={hunt.totalStops} done={hunt.completedStops} current={hunt.currentStop} surface="dark" />
        )}
        <ButtonLink href={hunt.href} size="lg" block className="rounded-[14px]">
          <Navigation2 className="h-5 w-5" strokeWidth={2.2} aria-hidden="true" />
          Resume hunt
        </ButtonLink>
      </div>
    </section>
  );
}

/** Same footprint as the dark card, so nothing jumps when it loads. */
export function ResumeCardSkeleton() {
  return (
    <div className="fm-shimmer mx-4 overflow-hidden rounded-card bg-ink" aria-hidden="true">
      <div className="h-[76px] bg-ink-raised" />
      <div className="flex flex-col gap-3.5 px-5 pb-5 pt-1">
        <div className="h-7 w-3/5 rounded-md bg-white/10" />
        <div className="h-5 w-4/5 rounded-md bg-white/10" />
        <div className="h-1.5 w-full rounded-full bg-white/10" />
        <div className="h-14 w-full rounded-2xl bg-white/10" />
      </div>
    </div>
  );
}
