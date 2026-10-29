"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FilterChip } from "@/components/ui/chip";
import { countLabel, insightsSummary } from "@/components/home/home-copy";

interface InsightsData {
  top_by_score: { hunt_id: string; title: string; audience: string; plays: number; avg_score: number }[];
  top_by_plays: { hunt_id: string; title: string; audience: string; plays: number; avg_score: number }[];
  challenge_type_insights: { challenge_type: string; avg_score: number; sample_size: number }[];
  audience_insights: { audience: string; total_plays: number; avg_score: number }[];
  total_hunts_with_data: number;
  total_completions: number;
}

type InsightsTab = "top" | "types" | "audiences";

const TABS: { key: InsightsTab; label: string }[] = [
  { key: "top", label: "Top hunts" },
  { key: "types", label: "Challenge types" },
  { key: "audiences", label: "Audiences" },
];

function hasAnyInsights(data: InsightsData): boolean {
  return data.top_by_score.length > 0 || data.challenge_type_insights.length > 0 || data.audience_insights.length > 0;
}

function EmptyTab() {
  return <p className="m-0 py-4 text-center text-sm text-themed-muted">No data yet</p>;
}

/**
 * Creator insights card on Home (inside "Your hunts"). Renders nothing until
 * there is something to compare, so creators never see an empty card.
 */
export default function InsightsPanel() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<InsightsTab>("top");

  useEffect(() => {
    fetch("/api/v1/analytics/insights")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data || data.total_completions === 0 || !hasAnyInsights(data)) return null;

  const summary = insightsSummary(data.total_hunts_with_data, data.total_completions);

  return (
    <section aria-labelledby="home-insights" className="rounded-card border border-themed-border bg-surface p-5">
      <h3 id="home-insights" className="m-0 font-[family-name:var(--font-display)] text-[22px] font-semibold leading-tight text-themed-text">
        Learn from other hunts
      </h3>
      {summary && <p className="m-0 mt-1 text-sm text-themed-muted">{summary}</p>}

      <div role="group" aria-label="Insight type" className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <FilterChip key={t.key} selected={tab === t.key} onToggle={() => setTab(t.key)}>
            {t.label}
          </FilterChip>
        ))}
      </div>

      <div className="mt-4">
        {tab === "top" &&
          (data.top_by_score.length === 0 ? (
            <EmptyTab />
          ) : (
            <ul className="m-0 flex max-h-64 list-none flex-col overflow-y-auto p-0">
              {data.top_by_score.map((h, i) => (
                <li key={h.hunt_id} className={i > 0 ? "border-t border-divider" : undefined}>
                  <Link
                    href={`/browse/${h.hunt_id}`}
                    className="flex min-h-11 items-center gap-3 py-2 text-[15px] text-themed-text no-underline hover:text-link"
                  >
                    <span className="w-7 shrink-0 font-semibold tabular-nums text-themed-muted">#{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{h.title}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-link">{h.avg_score} pts</span>
                    <span className="shrink-0 text-sm tabular-nums text-themed-muted">{countLabel(h.plays, "play")}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ))}

        {tab === "types" &&
          (data.challenge_type_insights.length === 0 ? (
            <EmptyTab />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {data.challenge_type_insights.map((ct) => (
                <li key={ct.challenge_type} className="flex items-center gap-3 text-[15px]">
                  <span className="min-w-0 flex-1 truncate capitalize text-themed-text">{ct.challenge_type.replace(/_/g, " ")}</span>
                  <span className="h-2 w-24 shrink-0 overflow-hidden rounded-full bg-divider" aria-hidden="true">
                    <span
                      className="block h-2 rounded-full bg-link transition-[width]"
                      style={{ width: `${Math.min(100, Math.max(0, ct.avg_score))}%` }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-themed-text">{ct.avg_score} pts</span>
                  <span className="w-12 shrink-0 text-right text-sm tabular-nums text-themed-muted">n={ct.sample_size}</span>
                </li>
              ))}
            </ul>
          ))}

        {tab === "audiences" &&
          (data.audience_insights.length === 0 ? (
            <EmptyTab />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {data.audience_insights.map((a) => (
                <li key={a.audience} className="flex items-center gap-3 text-[15px]">
                  <span className="inline-flex min-w-20 justify-center rounded-full bg-sky-tint px-[11px] py-[5px] text-[13px] font-semibold capitalize text-link">
                    {a.audience}
                  </span>
                  <span className="text-themed-muted">{countLabel(a.total_plays, "play")}</span>
                  <span className="font-semibold text-themed-text">avg {a.avg_score} pts</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
    </section>
  );
}
