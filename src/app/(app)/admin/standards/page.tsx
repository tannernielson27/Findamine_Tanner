"use client";

import { useState, useEffect } from "react";

interface Standard {
  id: string;
  code: string;
  domain: string | null;
  description: string;
  grade_level: string | null;
  standard_frameworks?: { code: string; abbreviation: string };
}

interface Framework {
  code: string;
  abbreviation: string;
  scope: string;
}

export default function AdminStandardsPage() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const getJson = async (url: string) => {
      const r = await fetch(url);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
      return body;
    };
    Promise.all([
      getJson("/api/v1/curriculum?type=frameworks"),
      getJson("/api/v1/curriculum?type=standards&limit=300"),
    ])
      .then(([fwData, stdData]) => {
        setFrameworks(fwData.frameworks || []);
        setStandards(stdData.standards || []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <main className="mx-auto max-w-4xl px-4 py-4"><p className="text-sm text-gray-500">Loading...</p></main>;
  }

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-4">
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Could not load standards: {error}
        </div>
      </main>
    );
  }

  // Group standards by framework
  const byFramework = new Map<string, Standard[]>();
  for (const std of standards) {
    const fwCode = std.standard_frameworks?.code || "unknown";
    if (!byFramework.has(fwCode)) byFramework.set(fwCode, []);
    byFramework.get(fwCode)!.push(std);
  }

  // Coverage summary
  const nationalFws = frameworks.filter((f) => f.scope === "national");
  const stateFws = frameworks.filter((f) => f.scope === "state");

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <h1 className="text-base font-semibold text-gray-900 mb-1">Standards Coverage Dashboard</h1>
      <p className="text-xs text-gray-500 mb-4">
        {standards.length} standards across {frameworks.length} frameworks
      </p>

      {/* Overview grid */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-sky-600">{standards.length}</div>
          <div className="text-xs text-gray-500">Total Standards</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-emerald-600">{nationalFws.length}</div>
          <div className="text-xs text-gray-500">National Frameworks</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3 text-center">
          <div className="text-2xl font-bold text-violet-600">{stateFws.length}</div>
          <div className="text-xs text-gray-500">State Frameworks</div>
        </div>
      </div>

      {/* Framework coverage heatmap */}
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Coverage by Framework</h2>
      <div className="space-y-2 mb-6">
        {frameworks.map((fw) => {
          const count = byFramework.get(fw.code)?.length || 0;
          const maxCount = Math.max(...Array.from(byFramework.values()).map((s) => s.length), 1);
          const pct = Math.round((count / maxCount) * 100);
          const color = count === 0 ? "bg-red-500" : count < 10 ? "bg-amber-500" : "bg-emerald-500";

          return (
            <div key={fw.code} className="flex items-center gap-3 text-xs">
              <span className="w-20 text-gray-700 font-medium truncate">{fw.abbreviation}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-3">
                <div className={`h-3 rounded-full ${color} transition-[width]`} style={{ width: `${Math.max(pct, 3)}%` }} />
              </div>
              <span className={`w-8 text-right font-medium ${count === 0 ? "text-red-600" : "text-gray-700"}`}>
                {count}
              </span>
            </div>
          );
        })}
      </div>

      {/* Gap analysis */}
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Frameworks with No Standards</h2>
      {frameworks.filter((fw) => !byFramework.has(fw.code) || byFramework.get(fw.code)!.length === 0).length === 0 ? (
        <p className="text-xs text-emerald-600 mb-6">All frameworks have at least one standard seeded.</p>
      ) : (
        <div className="space-y-1 mb-6">
          {frameworks
            .filter((fw) => !byFramework.has(fw.code) || byFramework.get(fw.code)!.length === 0)
            .map((fw) => (
              <div key={fw.code} className="text-xs text-red-600 bg-red-50 rounded px-3 py-1.5">
                {fw.abbreviation} — 0 standards (framework only)
              </div>
            ))}
        </div>
      )}

      {/* Detailed breakdown */}
      <h2 className="text-sm font-semibold text-gray-900 mb-2">Standards by Framework</h2>
      <div className="space-y-3">
        {Array.from(byFramework.entries())
          .sort(([, a], [, b]) => b.length - a.length)
          .map(([fwCode, stds]) => (
            <details key={fwCode} className="rounded-lg border border-gray-200 bg-white">
              <summary className="px-3 py-2 text-xs font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                {fwCode} — {stds.length} standard{stds.length !== 1 ? "s" : ""}
              </summary>
              <div className="px-3 pb-2 space-y-1">
                {stds.map((std) => (
                  <div key={std.id} className="text-[11px] text-gray-600 flex gap-2">
                    <span className="font-mono text-sky-700 shrink-0">{std.code}</span>
                    <span className="truncate">{std.description}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
      </div>
    </main>
  );
}
