"use client";

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import { ProgressRing } from "@/components/ui/progress";
import { parseWeeklyProgress, type WeeklyProgress } from "@/lib/gamification/weekly";
import { streakLine, weeklyHeadline } from "./home-data";

/**
 * "2 of 3 hunts this week" ring + streak (GET /api/v1/gamification/weekly).
 * A failed request shows an empty week rather than an error: the ring is
 * encouragement, not data the player must act on.
 */
export function WeeklyCard() {
  const [progress, setProgress] = useState<WeeklyProgress | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/gamification/weekly", { signal: controller.signal, credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => setProgress(parseWeeklyProgress(json)))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setProgress(parseWeeklyProgress(null));
      });
    return () => controller.abort();
  }, []);

  if (!progress) return <WeeklyCardSkeleton />;

  return (
    <section
      aria-label="This week"
      className="mx-4 mt-4 flex items-center gap-[18px] rounded-card border border-themed-border bg-surface px-5 py-[18px]"
    >
      <span className="text-themed-text">
        <ProgressRing value={progress.completedThisWeek} goal={progress.goal} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="font-[family-name:var(--font-display)] text-xl font-semibold leading-tight">{weeklyHeadline(progress)}</span>
        <span className="inline-flex items-center gap-1.5 text-[15px] text-themed-muted">
          <Flame className="h-[18px] w-[18px] text-brand" aria-hidden="true" />
          {streakLine(progress.streakWeeks)}
        </span>
      </div>
    </section>
  );
}

function WeeklyCardSkeleton() {
  return (
    <div className="fm-shimmer mx-4 mt-4 flex items-center gap-[18px] rounded-card border border-themed-border bg-surface px-5 py-[18px]" aria-hidden="true">
      <div className="h-[76px] w-[76px] shrink-0 rounded-full border-[10px] border-divider" />
      <div className="flex flex-1 flex-col gap-2">
        <div className="h-6 w-3/4 rounded-md bg-divider" />
        <div className="h-4 w-1/2 rounded-md bg-divider" />
      </div>
    </div>
  );
}
