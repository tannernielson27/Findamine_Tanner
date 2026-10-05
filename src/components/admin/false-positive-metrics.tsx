"use client";

import { useState, useEffect } from "react";

interface Metrics {
  total_labeled: number;
  total_relabeled: number;
  false_positive_rate: number;
  false_negative_rate: number;
  confusion_matrix: { truePositive: number; falsePositive: number; trueNegative: number; falseNegative: number };
  recent_relabels: { session_id: string; previous_label: string; new_label: string; created_at: string }[];
}

export default function FalsePositiveMetrics() {
  const [data, setData] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/v1/admin/false-positive-metrics")
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        // An error body has no confusion_matrix; rendering it would crash.
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        setData(body);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p role="alert" className="text-xs text-red-600">Could not load model metrics: {error}</p>;
  if (!data) return <div className="h-32 animate-pulse bg-gray-100 rounded" />;

  const cm = data.confusion_matrix;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">Labeled</p>
          <p className="text-xl font-bold text-gray-900">{data.total_labeled}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">False Positive Rate</p>
          <p className="text-xl font-bold text-orange-600">{(data.false_positive_rate * 100).toFixed(1)}%</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs text-gray-500">False Negative Rate</p>
          <p className="text-xl font-bold text-red-600">{(data.false_negative_rate * 100).toFixed(1)}%</p>
        </div>
      </div>

      {/* Confusion matrix */}
      <div>
        <h4 className="text-xs font-semibold text-gray-600 mb-2">Confusion Matrix</h4>
        <div className="grid grid-cols-3 gap-px bg-gray-200 rounded overflow-hidden text-center text-xs">
          <div className="bg-gray-50 p-2" />
          <div className="bg-gray-50 p-2 font-medium text-gray-600">Predicted Safe</div>
          <div className="bg-gray-50 p-2 font-medium text-gray-600">Predicted Threat</div>
          <div className="bg-gray-50 p-2 font-medium text-gray-600">Actual Safe</div>
          <div className="bg-green-50 p-2 font-bold text-green-800">TN: {cm.trueNegative}</div>
          <div className="bg-orange-50 p-2 font-bold text-orange-800">FP: {cm.falsePositive}</div>
          <div className="bg-gray-50 p-2 font-medium text-gray-600">Actual Threat</div>
          <div className="bg-red-50 p-2 font-bold text-red-800">FN: {cm.falseNegative}</div>
          <div className="bg-green-50 p-2 font-bold text-green-800">TP: {cm.truePositive}</div>
        </div>
      </div>

      {/* Recent relabels */}
      {data.recent_relabels.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-600 mb-2">Recent Re-labels</h4>
          <div className="space-y-1">
            {data.recent_relabels.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                <span className="font-mono truncate w-24">{(r.session_id || "").slice(0, 12)}...</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5">{r.previous_label}</span>
                <span className="text-gray-400">&rarr;</span>
                <span className="rounded bg-gray-100 px-1.5 py-0.5">{r.new_label}</span>
                <span className="text-gray-400 ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
