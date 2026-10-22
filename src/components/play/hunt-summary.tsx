"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import type { HuntSummaryData } from "@/lib/play/play-types";

interface HuntSummaryProps {
  summary: HuntSummaryData | null;
  totalStops: number;
}

const TOPO_RINGS =
  "repeating-radial-gradient(ellipse at 50% 30%, transparent 0 26px, rgba(255,255,255,0.06) 26px 27.5px)";

function elapsedMinutes(summary: HuntSummaryData | null): number | null {
  if (!summary?.startedAt || !summary?.completedAt) return null;
  return Math.round(
    (new Date(summary.completedAt).getTime() - new Date(summary.startedAt).getTime()) / 60000
  );
}

/** End-of-hunt summary in the stop-complete language: points, stops done, time. */
export function HuntSummary({ summary, totalStops }: HuntSummaryProps) {
  const elapsed = elapsedMinutes(summary);
  const stats = summary
    ? [
        { label: "Stops done", value: `${summary.findsCompleted}/${summary.totalFinds}` },
        { label: "Time", value: elapsed !== null ? `${elapsed}m` : "--" },
      ]
    : [];

  return (
    <section
      aria-labelledby="hunt-complete-title"
      className="absolute inset-0 flex flex-col items-center overflow-y-auto bg-juniper-deep px-6 pt-[calc(72px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))] text-white"
      style={{ backgroundImage: TOPO_RINGS }}
    >
      <span className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-juniper-bright text-juniper-deep shadow-[0_0_0_14px_rgba(111,207,151,0.18)]">
        <Trophy className="h-14 w-14" strokeWidth={2.4} aria-hidden="true" />
      </span>
      <p className="mt-7 text-base font-bold tracking-[0.08em] text-[#D6EFE0]">HUNT COMPLETE</p>
      <h1 id="hunt-complete-title" className="mt-2 text-balance text-center font-[family-name:var(--font-display)] text-[32px] font-semibold leading-tight">
        You finished all {totalStops} stops
      </h1>

      {summary && (
        <>
          <p className="mt-4 font-[family-name:var(--font-display)] text-[80px] font-bold leading-none tabular-nums">
            <CountUp value={summary.totalScore} />
          </p>
          <p className="mt-1 text-lg text-[#D6EFE0]">total points</p>
          <dl className="mt-8 grid w-full grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="flex flex-col-reverse items-center rounded-[20px] bg-white/10 px-3 py-4">
                <dt className="text-[15px] font-semibold">{s.label}</dt>
                <dd className="m-0 font-[family-name:var(--font-display)] text-[28px] font-bold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="min-h-8 flex-1" />

      <ButtonLink href="/dashboard" variant="light" size="xl" block>
        Back to Home
      </ButtonLink>
      <Link
        href="/browse"
        className="mt-2 inline-flex min-h-12 items-center rounded-xl px-3 text-base font-semibold text-[#D6EFE0] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        Find another hunt
      </Link>
    </section>
  );
}
