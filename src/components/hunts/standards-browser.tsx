"use client";

import { useState, useEffect } from "react";

interface Standard {
  id: string;
  code: string;
  domain: string | null;
  description: string;
  grade_level: string | null;
  standard_frameworks?: { code: string; name: string; abbreviation: string };
}

interface Task {
  id: string;
  title: string;
  challenge_type: string;
  subject_domain: string;
  difficulty_rating: number | null;
  alignment_strength?: string;
}

interface Framework {
  id: string;
  code: string;
  name: string;
  abbreviation: string;
  jurisdiction_country: string | null;
  jurisdiction_region: string | null;
  scope: string;
}

interface StandardsBrowserProps {
  onSelectTask: (task: Task) => void;
  onCancel: () => void;
}

export default function StandardsBrowser({ onSelectTask, onCancel }: StandardsBrowserProps) {
  const [frameworks, setFrameworks] = useState<Framework[]>([]);
  const [selectedFramework, setSelectedFramework] = useState<string>("");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [selectedStandard, setSelectedStandard] = useState<Standard | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  // Load frameworks on mount
  useEffect(() => {
    fetch("/api/v1/curriculum?type=frameworks")
      .then((r) => r.json())
      .then((d) => setFrameworks(d.frameworks || []));
  }, []);

  // Load tasks when a standard is selected (null clears them)
  function selectStandard(standard: Standard | null) {
    setSelectedStandard(standard);
    if (!standard) { setTasks([]); return; }
    setLoading(true);
    fetch(`/api/v1/curriculum?standard=${standard.code}`)
      .then((r) => r.json())
      .then((d) => { setTasks(d.tasks || []); setLoading(false); });
  }

  // Load standards when a framework is selected
  function selectFramework(framework: string) {
    setSelectedFramework(framework);
    selectStandard(null);
    if (!framework) { setStandards([]); return; }
    setLoading(true);
    fetch(`/api/v1/curriculum?type=standards&framework=${framework}&limit=100`)
      .then((r) => r.json())
      .then((d) => { setStandards(d.standards || []); setLoading(false); });
  }

  // Group frameworks by scope
  const national = frameworks.filter((f) => f.scope === "national");
  const state = frameworks.filter((f) => f.scope === "state");
  const international = frameworks.filter((f) => f.scope === "international");

  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Browse by Standard</h3>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
      </div>

      {/* Framework selector */}
      <select
        value={selectedFramework}
        onChange={(e) => selectFramework(e.target.value)}
        className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm mb-3"
      >
        <option value="">Select a standards framework...</option>
        {national.length > 0 && (
          <optgroup label="US National">
            {national.map((f) => (
              <option key={f.code} value={f.code}>{f.abbreviation} — {f.name}</option>
            ))}
          </optgroup>
        )}
        {state.length > 0 && (
          <optgroup label="US State">
            {state.map((f) => (
              <option key={f.code} value={f.code}>{f.abbreviation} ({f.jurisdiction_region}) — {f.name}</option>
            ))}
          </optgroup>
        )}
        {international.length > 0 && (
          <optgroup label="International">
            {international.map((f) => (
              <option key={f.code} value={f.code}>{f.abbreviation} — {f.name}</option>
            ))}
          </optgroup>
        )}
      </select>

      {/* Standards list */}
      {standards.length > 0 && !selectedStandard && (
        <div className="max-h-48 overflow-y-auto space-y-1">
          {standards.map((s) => (
            <button
              key={s.id}
              onClick={() => selectStandard(s)}
              className="w-full text-left rounded-md px-3 py-2 text-xs hover:bg-emerald-100 transition"
            >
              <span className="font-mono font-medium text-emerald-700">{s.code}</span>
              <span className="text-gray-400 mx-1.5">|</span>
              <span className="text-gray-500">{s.grade_level && `Gr ${s.grade_level}`}</span>
              <p className="text-gray-600 mt-0.5 line-clamp-1">{s.description}</p>
            </button>
          ))}
        </div>
      )}

      {/* Selected standard + aligned tasks */}
      {selectedStandard && (
        <div>
          <button
            onClick={() => selectStandard(null)}
            className="text-xs text-emerald-600 hover:underline mb-2"
          >
            &larr; Back to standards list
          </button>

          <div className="rounded-md bg-white border border-emerald-200 p-3 mb-3">
            <p className="text-xs font-mono font-medium text-emerald-700">{selectedStandard.code}</p>
            <p className="text-xs text-gray-600 mt-1">{selectedStandard.description}</p>
            {selectedStandard.domain && (
              <p className="text-[11px] text-gray-400 mt-1">Domain: {selectedStandard.domain}</p>
            )}
          </div>

          {loading ? (
            <div className="text-xs text-gray-500 text-center py-4">Loading aligned tasks...</div>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-4">No tasks aligned to this standard yet.</p>
          ) : (
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              <p className="text-xs text-gray-500 mb-1">{tasks.length} aligned task{tasks.length !== 1 ? "s" : ""}:</p>
              {tasks.map((task) => (
                <button
                  key={task.id}
                  onClick={() => onSelectTask(task)}
                  className="w-full text-left rounded-md border border-gray-200 bg-white px-3 py-2 hover:border-emerald-300 hover:bg-emerald-50 transition text-xs"
                >
                  <span className="font-medium text-gray-900">{task.title}</span>
                  <div className="flex gap-2 mt-0.5">
                    <span className="text-emerald-600">{task.challenge_type.replace(/_/g, " ")}</span>
                    {task.difficulty_rating && (
                      <span className="text-gray-400">difficulty {task.difficulty_rating}/10</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && !selectedStandard && standards.length === 0 && selectedFramework && (
        <div className="text-xs text-gray-500 text-center py-4">Loading standards...</div>
      )}
    </div>
  );
}
