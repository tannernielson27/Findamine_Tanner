"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Framework {
  id: string;
  code: string;
  name: string;
  abbreviation: string;
  scope: string;
  jurisdiction_region: string | null;
}

interface Standard {
  id: string;
  code: string;
  domain: string | null;
  description: string;
  grade_level: string | null;
  grade_range_min: number;
  grade_range_max: number;
}

interface Task {
  id: string;
  title: string;
  challenge_type: string;
  difficulty_rating: number | null;
  subject_domain: string;
}

const GRADE_BANDS = [
  { value: "", label: "All Grades" },
  { value: "0-2", label: "K-2" },
  { value: "3-5", label: "3-5" },
  { value: "6-8", label: "6-8" },
  { value: "9-12", label: "9-12" },
];

export default function StandardsExplorerPage() {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [selectedFramework, setSelectedFramework] = useState("");
  const [gradeBand, setGradeBand] = useState("");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [expandedStandard, setExpandedStandard] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/v1/curriculum?type=frameworks")
      .then((r) => r.json())
      .then((d) => setFrameworks(d.frameworks || []));
  }, []);

  // Load standards whenever the framework or grade band filter changes
  function loadStandards(framework: string, band: string) {
    if (!framework) { setStandards([]); return; }
    setLoading(true);
    const gradeParams = band ? `&grade_min=${band.split("-")[0]}&grade_max=${band.split("-")[1]}` : "";
    fetch(`/api/v1/curriculum?type=standards&framework=${framework}&limit=200${gradeParams}`)
      .then((r) => r.json())
      .then((d) => { setStandards(d.standards || []); setLoading(false); setExpandedStandard(null); });
  }

  function handleFrameworkChange(framework: string) {
    setSelectedFramework(framework);
    loadStandards(framework, gradeBand);
  }

  function handleGradeBandChange(band: string) {
    setGradeBand(band);
    loadStandards(selectedFramework, band);
  }

  function handleExpandStandard(std: Standard) {
    if (expandedStandard === std.id) {
      setExpandedStandard(null);
      return;
    }
    setExpandedStandard(std.id);
    fetch(`/api/v1/curriculum?standard=${std.code}`)
      .then((r) => r.json())
      .then((d) => setTasks(d.tasks || []));
  }

  const national = frameworks.filter((f) => f.scope === "national");
  const state = frameworks.filter((f) => f.scope === "state");

  return (
    <main>
      <div
        className="relative w-full h-16 sm:h-20 flex items-center justify-center overflow-hidden mb-4"
        style={{
          backgroundImage: "url(/hero-class.png)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        <div className="absolute inset-0 bg-black/50" />
        <h1 className="relative text-white text-lg sm:text-xl font-semibold tracking-wide drop-shadow-md">
          Standards Explorer
        </h1>
      </div>

      <div className="mx-auto max-w-4xl px-4">
        <p className="text-xs text-gray-500 mb-4">
          Find content aligned to your state or national standards. Select a framework and grade band to get started.
        </p>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          <select
            value={selectedFramework}
            onChange={(e) => handleFrameworkChange(e.target.value)}
            className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">Select a standards framework...</option>
            <optgroup label="US National">
              {national.map((f) => (
                <option key={f.code} value={f.code}>{f.abbreviation}</option>
              ))}
            </optgroup>
            <optgroup label="US State">
              {state.map((f) => (
                <option key={f.code} value={f.code}>{f.abbreviation} ({f.jurisdiction_region})</option>
              ))}
            </optgroup>
          </select>

          <select
            value={gradeBand}
            onChange={(e) => handleGradeBandChange(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            {GRADE_BANDS.map((g) => (
              <option key={g.value} value={g.value}>{g.label}</option>
            ))}
          </select>
        </div>

        {/* Standards grid */}
        {loading && (
          <div className="text-xs text-gray-500 text-center py-8">Loading standards...</div>
        )}

        {!loading && standards.length === 0 && selectedFramework && (
          <div className="text-xs text-gray-500 text-center py-8">
            No standards found for this selection.
          </div>
        )}

        {!loading && standards.length > 0 && (
          <div className="space-y-2">
            {standards.map((std) => (
              <div key={std.id}>
                <button
                  onClick={() => handleExpandStandard(std)}
                  className={`w-full text-left rounded-lg border p-3 transition ${
                    expandedStandard === std.id
                      ? "border-sky-300 bg-sky-50"
                      : "border-gray-200 bg-white hover:border-sky-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs font-medium text-sky-700 bg-sky-100 rounded px-1.5 py-0.5 shrink-0">
                      {std.code}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-gray-900">{std.description}</p>
                      <div className="flex gap-2 mt-1 text-[11px] text-gray-500">
                        {std.grade_level && <span>Grade {std.grade_level}</span>}
                        {std.domain && <span>· {std.domain}</span>}
                      </div>
                    </div>
                    <span className="text-gray-400 text-xs">{expandedStandard === std.id ? "▲" : "▼"}</span>
                  </div>
                </button>

                {/* Expanded: show aligned tasks */}
                {expandedStandard === std.id && (
                  <div className="ml-6 mt-1 mb-2 space-y-1.5">
                    {tasks.length === 0 ? (
                      <p className="text-[11px] text-gray-400 py-2">No aligned content yet for this standard.</p>
                    ) : (
                      <>
                        <p className="text-[11px] text-gray-500">{tasks.length} aligned task{tasks.length !== 1 ? "s" : ""}:</p>
                        {tasks.map((task) => (
                          <div key={task.id} className="flex items-center gap-2 rounded border border-gray-100 bg-white px-3 py-1.5 text-xs">
                            <span className="flex-1 text-gray-900">{task.title}</span>
                            <span className="text-sky-600 text-[11px]">{task.challenge_type.replace(/_/g, " ")}</span>
                            {task.difficulty_rating && (
                              <span className="text-gray-400 text-[11px]">diff {task.difficulty_rating}</span>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!selectedFramework && (
          <div className="text-center py-12">
            <p className="text-sm text-gray-500 mb-2">Select a framework above to explore standards</p>
            <p className="text-xs text-gray-400">
              {frameworks.length} frameworks available across {frameworks.filter(f => f.scope === "state").length} US states
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <Link href="/browse" className="text-xs text-sky-600 hover:underline">
            &larr; Back to Browse Hunts
          </Link>
        </div>
      </div>
    </main>
  );
}
