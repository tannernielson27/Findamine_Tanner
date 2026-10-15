"use client";

import { useState, useEffect } from "react";
import { formatGradeRange } from "@/lib/utils/grade-bands";

interface LibraryTask {
  id: string;
  title: string;
  description: string | null;
  subject_domain: string;
  challenge_type: string;
  content: Record<string, unknown>;
  grade_range_min: number | null;
  grade_range_max: number | null;
  difficulty_level: number | null;
  location_dependency: string;
  location_type: string;
}

interface CurriculumBrowserProps {
  onSelect: (task: LibraryTask) => void;
  onCancel: () => void;
}

const SUBJECTS = [
  { value: "", label: "All Subjects" },
  { value: "science_nature", label: "Science & Nature" },
  { value: "math_real_world", label: "Math" },
  { value: "geography_maps", label: "Geography & Maps" },
  { value: "critical_thinking", label: "Critical Thinking" },
  { value: "reading_writing", label: "Reading & Writing" },
  { value: "history_community", label: "History & Community" },
];

const LOCATION_TYPES = [
  { value: "", label: "All Locations" },
  { value: "any", label: "Works Anywhere" },
  { value: "park", label: "Park" },
  { value: "water", label: "Water Feature" },
  { value: "mountain", label: "Mountain" },
  { value: "trail", label: "Trail" },
  { value: "urban", label: "Urban / Street" },
  { value: "farm", label: "Farm / Garden" },
  { value: "forest", label: "Forest" },
  { value: "campus", label: "Campus" },
  { value: "historic", label: "Historic Site" },
  { value: "field", label: "Open Field" },
];

const CHALLENGE_TYPES = [
  { value: "", label: "All Types" },
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "numeric_entry", label: "Numeric Entry" },
  { value: "short_text", label: "Short Text" },
  { value: "creative_writing", label: "Creative Writing" },
  { value: "photo_observation", label: "Photo Observation" },
  { value: "data_collection", label: "Data Collection" },
  { value: "sketch_draw", label: "Sketch / Draw" },
  { value: "sorting_ordering", label: "Sorting / Ordering" },
  { value: "audio_response", label: "Audio Response" },
  { value: "team_debate", label: "Team Debate" },
];

export default function CurriculumBrowser({ onSelect, onCancel }: CurriculumBrowserProps) {
  const [tasks, setTasks] = useState<LibraryTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState("");
  const [locationType, setLocationType] = useState("");
  const [challengeType, setChallengeType] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams();
      if (subject) params.set("subject", subject);
      if (locationType) params.set("location_type", locationType);
      if (challengeType) params.set("challenge_type", challengeType);
      if (search.length >= 2) params.set("q", search);
      params.set("limit", "30");

      const res = await fetch(`/api/v1/curriculum?${params}`);
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
      setLoading(false);
    }, search ? 300 : 0);

    return () => clearTimeout(timer);
  }, [subject, locationType, challengeType, search]);

  return (
    <div className="rounded-xl border border-sky-200 bg-white p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Curriculum Library</h3>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Close</button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <select value={subject} onChange={(e) => setSubject(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-xs" aria-label="Filter by subject">
          {SUBJECTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select value={locationType} onChange={(e) => setLocationType(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-xs" aria-label="Filter by location type">
          {LOCATION_TYPES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <select value={challengeType} onChange={(e) => setChallengeType(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-xs" aria-label="Filter by challenge type">
          {CHALLENGE_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          aria-label="Search curriculum"
          className="rounded-md border border-gray-300 px-2 py-1.5 text-xs"
        />
      </div>

      {/* Results */}
      <div className="max-h-64 overflow-y-auto divide-y divide-gray-100">
        {loading ? (
          <div className="py-6 text-center text-xs text-gray-500">Loading...</div>
        ) : tasks.length === 0 ? (
          <div className="py-6 text-center text-xs text-gray-500">No tasks match your filters.</div>
        ) : (
          tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => onSelect(task)}
              className="w-full text-left px-3 py-2.5 hover:bg-sky-50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{task.title}</p>
                  <div className="flex gap-1.5 mt-0.5 flex-wrap">
                    <span className="text-[10px] bg-sky-50 text-sky-700 rounded px-1 py-0.5">
                      {task.challenge_type.replace(/_/g, " ")}
                    </span>
                    <span className="text-[10px] bg-gray-100 text-gray-600 rounded px-1 py-0.5">
                      {task.subject_domain?.replace(/_/g, " ") || "general"}
                    </span>
                    {task.location_type !== "any" && (
                      <span className="text-[10px] bg-green-50 text-green-700 rounded px-1 py-0.5">
                        {task.location_type}
                      </span>
                    )}
                    {task.grade_range_min != null && (
                      <span className="text-[10px] text-gray-500">
                        {formatGradeRange(task.grade_range_min, task.grade_range_max)}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-sky-600 text-xs shrink-0 mt-1">Use</span>
              </div>
            </button>
          ))
        )}
      </div>

      <p className="text-[10px] text-gray-500 mt-2 text-center">
        {tasks.length} task{tasks.length !== 1 ? "s" : ""} found. Click to use in your hunt.
      </p>
    </div>
  );
}
