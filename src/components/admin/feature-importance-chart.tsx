"use client";

import { useState, useEffect } from "react";

interface ImportanceEntry {
  feature: string;
  label: string;
  category: string;
  importance: number;
  direction: string;
}

interface ShapEntry {
  feature: string;
  marginal_contribution: number;
}

export default function FeatureImportanceChart({
  sessionId,
  onFeatureClick,
}: {
  sessionId?: string;
  onFeatureClick?: (feature: string) => void;
}) {
  const [mode, setMode] = useState<"pfi" | "shap">(sessionId ? "shap" : "pfi");
  const [pfiData, setPfiData] = useState<ImportanceEntry[]>([]);
  const [shapData, setShapData] = useState<ShapEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getJson = async (url: string) => {
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
      return body;
    };
    if (mode === "pfi") {
      getJson("/api/v1/admin/feature-importance")
        .then((d) => { setPfiData(d.importance || []); setError(null); })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else if (mode === "shap" && sessionId) {
      getJson(`/api/v1/admin/shap-explain?session_id=${encodeURIComponent(sessionId)}`)
        .then((d) => { setShapData(d.contributions || []); setError(null); })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [mode, sessionId]);

  if (loading) {
    return <div className="h-48 fm-shimmer bg-gray-100 rounded" />;
  }

  return (
    <div>
      {error && <p role="alert" className="mb-2 text-xs text-red-600">Could not load feature importance: {error}</p>}
      {/* Mode toggle */}
      {sessionId && (
        <div className="flex gap-1 mb-3">
          <button
            onClick={() => { setMode("pfi"); setLoading(true); }}
            className={`px-3 py-1 rounded text-xs font-medium ${mode === "pfi" ? "bg-sky-100 text-sky-800" : "bg-gray-100 text-gray-600"}`}
          >
            Global (PFI)
          </button>
          <button
            onClick={() => { setMode("shap"); setLoading(true); }}
            className={`px-3 py-1 rounded text-xs font-medium ${mode === "shap" ? "bg-sky-100 text-sky-800" : "bg-gray-100 text-gray-600"}`}
          >
            Session (SHAP)
          </button>
        </div>
      )}

      {/* PFI mode */}
      {mode === "pfi" && (
        <div className="space-y-1.5">
          {pfiData.map((entry) => (
            <button
              key={entry.feature}
              onClick={() => onFeatureClick?.(entry.feature)}
              className="w-full flex items-center gap-2 text-xs hover:bg-gray-50 rounded px-1 py-0.5 transition-colors text-left"
            >
              <span className="w-44 truncate text-gray-700 underline decoration-dotted cursor-pointer">
                {entry.label}
              </span>
              <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    entry.direction === "increases_threat" ? "bg-red-400" : "bg-blue-400"
                  }`}
                  style={{ width: `${Math.round(entry.importance * 100)}%` }}
                />
              </div>
              <span className="w-10 text-right text-gray-500">
                {Math.round(entry.importance * 100)}%
              </span>
            </button>
          ))}
          <div className="flex gap-4 mt-2 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-400" /> Increases threat</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-400" /> Decreases threat</span>
          </div>
        </div>
      )}

      {/* SHAP mode */}
      {mode === "shap" && (
        <div className="space-y-1.5">
          {shapData
            .sort((a, b) => Math.abs(b.marginal_contribution) - Math.abs(a.marginal_contribution))
            .map((entry) => (
              <button
                key={entry.feature}
                onClick={() => onFeatureClick?.(entry.feature)}
                className="w-full flex items-center gap-2 text-xs hover:bg-gray-50 rounded px-1 py-0.5 transition-colors text-left"
              >
                <span className="w-44 truncate text-gray-700 underline decoration-dotted cursor-pointer">
                  {entry.feature.replace(/_/g, " ")}
                </span>
                <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden relative">
                  <div
                    className={`h-full rounded-full ${entry.marginal_contribution > 0 ? "bg-red-400" : "bg-blue-400"}`}
                    style={{ width: `${Math.min(Math.abs(entry.marginal_contribution) * 2, 100)}%` }}
                  />
                </div>
                <span className={`w-10 text-right ${entry.marginal_contribution > 0 ? "text-red-600" : "text-blue-600"}`}>
                  {entry.marginal_contribution > 0 ? "+" : ""}{entry.marginal_contribution.toFixed(1)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
