"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface InsightsData {
  top_by_score: { hunt_id: string; title: string; audience: string; plays: number; avg_score: number }[];
  top_by_plays: { hunt_id: string; title: string; audience: string; plays: number; avg_score: number }[];
  challenge_type_insights: { challenge_type: string; avg_score: number; sample_size: number }[];
  audience_insights: { audience: string; total_plays: number; avg_score: number }[];
  total_hunts_with_data: number;
  total_completions: number;
}

export default function InsightsPanel() {
  const [data, setData] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"top" | "types" | "audiences">("top");

  useEffect(() => {
    fetch("/api/v1/analytics/insights")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return null;
  if (!data || data.total_completions === 0) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Learn from Other Hunts</h3>
      <p className="text-[11px] text-gray-500 mb-3">
        {data.total_hunts_with_data} hunts · {data.total_completions} total completions
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-3">
        {[
          { key: "top" as const, label: "Top Hunts" },
          { key: "types" as const, label: "Challenge Types" },
          { key: "audiences" as const, label: "Audiences" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
              tab === t.key ? "bg-sky-100 text-sky-700" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Top Hunts */}
      {tab === "top" && (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {data.top_by_score.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No data yet</p>
          ) : (
            data.top_by_score.map((h, i) => (
              <Link
                key={h.hunt_id}
                href={`/browse/${h.hunt_id}`}
                className="flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50 transition"
              >
                <span className="w-5 text-gray-400 font-medium">#{i + 1}</span>
                <span className="flex-1 text-gray-900 truncate">{h.title}</span>
                <span className="text-sky-600 font-medium">{h.avg_score} pts</span>
                <span className="text-gray-400">{h.plays} plays</span>
              </Link>
            ))
          )}
        </div>
      )}

      {/* Challenge Type Insights */}
      {tab === "types" && (
        <div className="space-y-1.5">
          {data.challenge_type_insights.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No data yet</p>
          ) : (
            data.challenge_type_insights.map((ct) => (
              <div key={ct.challenge_type} className="flex items-center gap-2 text-xs">
                <span className="flex-1 text-gray-700">{ct.challenge_type.replace(/_/g, " ")}</span>
                <div className="w-24 bg-gray-100 rounded-full h-2">
                  <div
                    className="h-2 rounded-full bg-sky-500 transition-[width]"
                    style={{ width: `${ct.avg_score}%` }}
                  />
                </div>
                <span className="w-12 text-right text-gray-600 font-medium">{ct.avg_score} pts</span>
                <span className="w-10 text-right text-gray-400">n={ct.sample_size}</span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Audience Insights */}
      {tab === "audiences" && (
        <div className="space-y-1.5">
          {data.audience_insights.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No data yet</p>
          ) : (
            data.audience_insights.map((a) => (
              <div key={a.audience} className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-sky-50 px-2 py-0.5 text-sky-700 text-[11px] w-16 text-center">
                  {a.audience}
                </span>
                <span className="text-gray-600">{a.total_plays} plays</span>
                <span className="text-gray-700 font-medium">avg {a.avg_score} pts</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
