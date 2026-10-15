"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface AnalyticsData {
  analytics_available: boolean;
  total_plays: number;
  avg_score: number;
  completion_rate: number;
  avg_duration_min: number;
  // One entry per stop, in hunt order. avg_* are null until someone has played that stop.
  stops: StopRow[];
  hardest_stop: StopRow | null;
  easiest_stop: StopRow | null;
  message?: string;
}

interface StopRow {
  find_id: string;
  stop_number: number;
  name: string | null;
  avg_score: number | null;
  avg_hints: number | null;
  completion_count: number;
}

function stopLabel(stop: StopRow): string {
  return stop.name ? `Stop ${stop.stop_number}: ${stop.name}` : `Stop ${stop.stop_number}`;
}

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function HuntAnalyticsPage() {
  const { id } = useParams();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [huntTitle, setHuntTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // The title is a nicety; a failure there must not hide the analytics.
    fetch(`/api/v1/hunts/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((huntData) => setHuntTitle(huntData?.hunt?.title || "Hunt"))
      .catch(() => setHuntTitle("Hunt"));

    fetch(`/api/v1/hunts/${id}/analytics`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(body?.error || `Analytics request failed (${r.status})`);
        setData(body);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load analytics"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <main className="mx-auto max-w-4xl px-4 py-4"><p className="text-sm text-gray-500">Loading analytics...</p></main>;
  }

  function handleExportCSV() {
    if (!data?.stops) return;
    const headers = "Stop,Name,Avg Score,Avg Hints,Completions";
    const rows = data.stops.map((s) =>
      [s.stop_number, s.name, s.avg_score, s.avg_hints, s.completion_count].map(csvCell).join(",")
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${huntTitle.replace(/\s+/g, "_")}_analytics.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href={`/dashboard/hunts/${id}`} className="text-sm text-brand hover:underline mb-3 inline-block">
        &larr; Back to hunt
      </Link>

      <h1 className="text-base font-bold text-gray-900 mb-1">Analytics: {huntTitle}</h1>

      {error || !data ? (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
          Couldn&apos;t load analytics for this hunt: {error || "no data returned"}. Reload the page to try again.
        </div>
      ) : !data.analytics_available ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
          <p className="text-gray-500">{data.message || "Not enough data yet."}</p>
          <p className="text-xs text-gray-400 mt-1">{data.total_plays || 0} plays so far</p>
        </div>
      ) : data.total_plays === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-200 p-8 text-center">
          <p className="text-gray-500">No one has finished this hunt yet.</p>
          <p className="text-xs text-gray-400 mt-1">Analytics appear here after the first completed play.</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-sky-600">{data.total_plays}</div>
              <div className="text-xs text-gray-500">Total Plays</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-emerald-600">{data.avg_score}</div>
              <div className="text-xs text-gray-500">Avg Score</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-violet-600">{data.completion_rate}%</div>
              <div className="text-xs text-gray-500">Completion Rate</div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
              <div className="text-2xl font-bold text-amber-600">{data.avg_duration_min}m</div>
              <div className="text-xs text-gray-500">Avg Duration</div>
            </div>
          </div>

          {/* Per-stop breakdown */}
          {data.stops.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-900">Per-Stop Breakdown</h2>
                <button onClick={handleExportCSV} className="text-xs text-sky-600 hover:underline">
                  Export CSV
                </button>
              </div>

              {/* Bar chart */}
              <div className="space-y-2 mb-4">
                {data.stops.map((stop) => (
                  <div key={stop.find_id} className="flex items-center gap-2 text-xs">
                    <span className="w-14 text-gray-500 shrink-0" title={stopLabel(stop)}>Stop {stop.stop_number}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 relative">
                      {stop.avg_score !== null && (
                        <div
                          className="h-4 rounded-full transition-[width] flex items-center justify-end pr-1"
                          style={{
                            width: `${Math.min(Math.max(stop.avg_score, 5), 100)}%`,
                            backgroundColor: stop.avg_score >= 70 ? "#22c55e" : stop.avg_score >= 40 ? "#f59e0b" : "#ef4444",
                          }}
                        >
                          <span className="text-[10px] text-white font-medium">{stop.avg_score}</span>
                        </div>
                      )}
                    </div>
                    <span className="w-20 text-right text-gray-400 shrink-0">
                      {stop.avg_hints !== null ? `${stop.avg_hints} hints` : "not played yet"}
                    </span>
                  </div>
                ))}
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 text-gray-500">
                      <th className="text-left py-1.5 pr-3">Stop</th>
                      <th className="text-right py-1.5 px-3">Avg Score</th>
                      <th className="text-right py-1.5 px-3">Avg Hints</th>
                      <th className="text-right py-1.5 pl-3">Completions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stops.map((stop) => (
                      <tr key={stop.find_id} className="border-b border-gray-100">
                        <td className="py-1.5 pr-3 text-gray-900">{stopLabel(stop)}</td>
                        <td className="text-right py-1.5 px-3">
                          {stop.avg_score !== null ? (
                            <span className={`font-medium ${stop.avg_score >= 70 ? "text-green-600" : stop.avg_score >= 40 ? "text-amber-600" : "text-red-600"}`}>
                              {stop.avg_score}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="text-right py-1.5 px-3 text-gray-600">{stop.avg_hints ?? "—"}</td>
                        <td className="text-right py-1.5 pl-3 text-gray-600">{stop.completion_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Insights */}
          {data.hardest_stop && data.easiest_stop && data.hardest_stop.find_id !== data.easiest_stop.find_id && (
            <div className="grid grid-cols-2 gap-3 mb-6">
              <div className="rounded-lg bg-red-50 border border-red-200 p-3">
                <p className="text-xs font-medium text-red-700">Hardest Stop</p>
                <p className="text-sm text-red-600 font-bold">
                  {stopLabel(data.hardest_stop)}
                </p>
                <p className="text-xs text-red-500">Avg score: {data.hardest_stop.avg_score}</p>
              </div>
              <div className="rounded-lg bg-green-50 border border-green-200 p-3">
                <p className="text-xs font-medium text-green-700">Easiest Stop</p>
                <p className="text-sm text-green-600 font-bold">
                  {stopLabel(data.easiest_stop)}
                </p>
                <p className="text-xs text-green-500">Avg score: {data.easiest_stop.avg_score}</p>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
