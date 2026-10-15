"use client";

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";
import { Collapse } from "@/components/ui/collapse";

interface Analytics {
  analytics_available: boolean;
  total_plays: number;
  avg_score?: number;
  completion_rate?: number;
  avg_duration_min?: number;
  hardest_stop?: { find_id: string; stop_number: number; avg_score: number } | null;
  easiest_stop?: { find_id: string; stop_number: number; avg_score: number } | null;
  // One entry per stop in hunt order; avg_* are null until someone has played that stop.
  stops?: { find_id: string; stop_number: number; avg_score: number | null; avg_hints: number | null; completion_count: number }[];
  message?: string;
}

interface HuntAnalyticsProps {
  huntId: string;
  compact?: boolean;
}

function scoreBarClass(score: number): string {
  if (score >= 70) return "bg-success";
  if (score >= 40) return "bg-warning";
  return "bg-error";
}

export default function HuntAnalytics({ huntId, compact = false }: HuntAnalyticsProps) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/hunts/${huntId}/analytics`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [huntId]);

  if (loading) return null;
  if (!data || data.total_plays === 0) return null;

  if (!data.analytics_available) {
    return (
      <p className="mt-2 text-sm tabular-nums text-themed-muted">
        {data.total_plays} play{data.total_plays !== 1 ? "s" : ""} — analytics unlock at 5 completions
      </p>
    );
  }

  if (compact) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-sm tabular-nums text-themed-muted">
        <span>{data.total_plays} plays</span>
        <span>avg {data.avg_score} pts</span>
        <span>{data.completion_rate}% finish</span>
      </div>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-themed-border bg-surface px-4 py-1 shadow-[var(--shadow-card)]">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left"
      >
        <span className="min-w-0 text-sm font-medium tabular-nums text-themed-text">
          Performance: {data.total_plays} plays · avg {data.avg_score} pts · {data.completion_rate}% finish rate
        </span>
        <ChevronDown
          className={`w-5 h-5 shrink-0 text-themed-muted transition-transform ${expanded ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      <Collapse open={expanded}>
        <div className="mt-2 mb-3 space-y-4">
          {/* Summary stats */}
          <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
            <Stat value={data.total_plays} label="Plays" />
            <Stat value={data.avg_score} label="Avg Score" />
            <Stat value={`${data.completion_rate}%`} label="Finish Rate" />
            <Stat value={`${data.avg_duration_min}m`} label="Avg Time" />
          </div>

          {/* Stop-level breakdown */}
          {data.stops && data.stops.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-themed-muted">Per-Stop Performance</p>
              <div className="space-y-1.5">
                {data.stops.map((stop) => (
                  <div key={stop.find_id} className="flex items-center gap-2 text-sm tabular-nums">
                    <span className="w-7 shrink-0 text-themed-muted">#{stop.stop_number}</span>
                    <div className="h-2 min-w-0 flex-1 rounded-full bg-themed-bg">
                      {stop.avg_score !== null && (
                        <div
                          className={`h-2 rounded-full ${scoreBarClass(stop.avg_score)}`}
                          style={{ width: `${Math.min(stop.avg_score, 100)}%` }}
                        />
                      )}
                    </div>
                    {stop.avg_score !== null ? (
                      <>
                        <span className="w-14 shrink-0 text-right text-themed-text">{stop.avg_score} pts</span>
                        <span className="w-20 shrink-0 text-right text-themed-muted">{stop.avg_hints} hints</span>
                      </>
                    ) : (
                      <span className="w-34 shrink-0 text-right text-themed-muted">not played yet</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hardest/easiest */}
          {data.hardest_stop && data.easiest_stop && data.stops && data.stops.length > 2 && (
            <div className="flex flex-col gap-2 text-sm tabular-nums sm:flex-row">
              <div className="flex-1 rounded-lg bg-error/10 p-2">
                <span className="font-medium text-error">Hardest stop:</span>
                <span className="ml-1 text-themed-text">#{data.hardest_stop.stop_number} ({data.hardest_stop.avg_score} pts avg)</span>
              </div>
              <div className="flex-1 rounded-lg bg-secondary/10 p-2">
                <span className="font-medium text-secondary">Easiest stop:</span>
                <span className="ml-1 text-themed-text">#{data.easiest_stop.stop_number} ({data.easiest_stop.avg_score} pts avg)</span>
              </div>
            </div>
          )}
        </div>
      </Collapse>
    </section>
  );
}

function Stat({ value, label }: { value: number | string | undefined; label: string }) {
  return (
    <div className="rounded-lg bg-themed-bg p-2">
      <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{value}</div>
      <div className="text-sm text-themed-muted">{label}</div>
    </div>
  );
}
