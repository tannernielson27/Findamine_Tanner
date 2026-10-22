"use client";

import { useRouter } from "next/navigation";
import { Trophy } from "lucide-react";
import type { HuntSummaryData } from "@/lib/play/play-types";

interface HuntSummaryProps {
  summary: HuntSummaryData | null;
  totalStops: number;
}

function elapsedMinutes(summary: HuntSummaryData | null): number | null {
  if (!summary?.startedAt || !summary?.completedAt) return null;
  return Math.round(
    (new Date(summary.completedAt).getTime() - new Date(summary.startedAt).getTime()) / 60000
  );
}

/** End-of-hunt summary: points, stops done, time. */
export function HuntSummary({ summary, totalStops }: HuntSummaryProps) {
  const router = useRouter();
  const elapsed = elapsedMinutes(summary);

  return (
    <div className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] px-5 py-8 text-center sm:px-8">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/10 text-secondary">
        <Trophy className="h-8 w-8" aria-hidden="true" />
      </div>
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text mb-2 text-balance">Hunt Complete!</h1>
      <p className="font-[family-name:var(--font-handwritten)] text-xl text-themed-muted mb-8">You finished all {totalStops} stops</p>

      {summary && (
        <div className="grid grid-cols-3 gap-2 mb-8 sm:gap-4">
          <div className="rounded-xl border border-themed-border bg-themed-bg px-2 py-4 sm:p-5">
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-themed-text sm:text-3xl">{summary.totalScore}</div>
            <div className="text-sm text-themed-muted mt-1">Total Points</div>
          </div>
          <div className="rounded-xl border border-themed-border bg-themed-bg px-2 py-4 sm:p-5">
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-secondary sm:text-3xl">
              {summary.findsCompleted}/{summary.totalFinds}
            </div>
            <div className="text-sm text-themed-muted mt-1">Stops Done</div>
          </div>
          <div className="rounded-xl border border-themed-border bg-themed-bg px-2 py-4 sm:p-5">
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-themed-text sm:text-3xl">
              {elapsed !== null ? `${elapsed}m` : "--"}
            </div>
            <div className="text-sm text-themed-muted mt-1">Time</div>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          onClick={() => router.push("/dashboard")}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
        >
          Back to Dashboard
        </button>
        <button
          onClick={() => router.push("/browse")}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 w-full px-5 sm:w-auto"
        >
          Find More Hunts
        </button>
      </div>
    </div>
  );
}
