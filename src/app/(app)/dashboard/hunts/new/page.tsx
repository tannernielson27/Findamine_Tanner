"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import LocationPicker from "@/components/maps/location-picker";
import { HUNT_PRESETS, type HuntPreset } from "@/lib/utils/hunt-presets";
import { GRADE_BANDS, DEFAULT_GRADE_BAND, gradeBandFor } from "@/lib/utils/grade-bands";

const SUBJECTS = [
  { value: "science_nature", label: "Science & Nature" },
  { value: "math_real_world", label: "Math" },
  { value: "geography_maps", label: "Geography & Maps" },
  { value: "critical_thinking", label: "Critical Thinking" },
  { value: "reading_writing", label: "Reading & Writing" },
  { value: "history_community", label: "History & Community" },
];

const LOCATION_TYPES = [
  { value: "any", label: "Any Location" },
  { value: "park", label: "Park" },
  { value: "trail", label: "Trail" },
  { value: "water", label: "Near Water" },
  { value: "urban", label: "Urban / Downtown" },
  { value: "campus", label: "School / Campus" },
  { value: "forest", label: "Forest" },
  { value: "historic", label: "Historic Site" },
  { value: "field", label: "Open Field" },
];

// AI-composed stops have a task and a clue but no real-world position yet. They
// are dropped on a small ring around the hunt center so they are valid, visible
// on the map, and obviously not final; each is flagged needs_placement until the
// creator edits it.
const PLACEHOLDER_RING_METERS = 60;
const METERS_PER_DEGREE_LAT = 111_320;

function placeholderPosition(centerLat: number, centerLng: number, index: number, total: number) {
  const angle = (2 * Math.PI * index) / Math.max(total, 1);
  const metersPerDegreeLng = METERS_PER_DEGREE_LAT * Math.max(Math.cos((centerLat * Math.PI) / 180), 0.01);
  return {
    latitude: centerLat + (PLACEHOLDER_RING_METERS * Math.cos(angle)) / METERS_PER_DEGREE_LAT,
    longitude: centerLng + (PLACEHOLDER_RING_METERS * Math.sin(angle)) / metersPerDegreeLng,
  };
}

/** POST JSON and return the parsed body, throwing the server's own message on failure. */
async function postJson(url: string, body: unknown, failure: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ? `${failure}: ${data.error}` : `${failure} (error ${res.status})`);
  return data;
}

export default function NewHuntPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // AI builder state
  const [aiSubjects, setAiSubjects] = useState<string[]>(["science_nature"]);
  const [aiGradeBand, setAiGradeBand] = useState<string>(DEFAULT_GRADE_BAND);
  const [aiLocationType, setAiLocationType] = useState("any");
  const [aiStops, setAiStops] = useState("5");
  const [aiDuration, setAiDuration] = useState("40");
  const [aiDifficulty, setAiDifficulty] = useState("ascending");
  const [aiTheme, setAiTheme] = useState("");
  // Hunt center point
  const [centerLat, setCenterLat] = useState<number | null>(null);
  const [centerLng, setCenterLng] = useState<number | null>(null);
  const [showCenterPicker, setShowCenterPicker] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<HuntPreset | null>(null);
  // Controlled so a preset can fill them in visibly and the creator can still change them.
  const [audience, setAudience] = useState("all");
  const [playMode, setPlayMode] = useState("solo");
  const [identityMode, setIdentityMode] = useState("codename_assigned");
  // Set when the AI hunt was created but some of its stops could not be.
  const [partialHuntId, setPartialHuntId] = useState<string | null>(null);

  function applyPreset(preset: HuntPreset) {
    setSelectedPreset(preset);
    setAudience(preset.settings.target_audience);
    setPlayMode(preset.settings.play_mode);
    setIdentityMode(preset.settings.identity_mode);
    setMode("manual");
    setAiResult(null);
  }

  const [aiResult, setAiResult] = useState<{
    title: string;
    description: string;
    theme_narrative: string;
    stops: { task_id: string; primer_id: string; sort_order: number; suggested_clue: string; clue_hints: string[] }[];
  } | null>(null);

  async function handleManualSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/v1/hunts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        description: form.get("description"),
        // What the selects show is what gets saved; a preset only pre-fills them.
        target_audience: audience,
        play_mode: playMode,
        identity_mode: identityMode,
        estimated_duration_min: form.get("duration") ? parseInt(form.get("duration") as string) : null,
        center_latitude: centerLat,
        center_longitude: centerLng,
        ...(selectedPreset ? { metadata: selectedPreset.settings.metadata } : {}),
      }),
    }).catch(() => null);

    const data = res ? await res.json().catch(() => null) : null;

    if (!res || !res.ok || !data?.hunt) {
      setError(data?.error || "Failed to create hunt. Check your connection and try again.");
      setLoading(false);
      return;
    }

    router.push(`/dashboard/hunts/${data.hunt.id}`);
  }

  async function handleAIGenerate() {
    setLoading(true);
    setError("");
    setAiResult(null);

    try {
      const res = await fetch("/api/v1/ai/recommend-hunt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_domains: aiSubjects,
          grade_band: aiGradeBand,
          target_audience: gradeBandFor(aiGradeBand).audience,
          location_type: aiLocationType,
          target_duration_min: parseInt(aiDuration),
          difficulty_progression: aiDifficulty,
          num_stops: parseInt(aiStops),
          theme: aiTheme || undefined,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `AI generation failed (error ${res.status})`);

      const recommendation = data?.recommendation;
      if (!recommendation || !Array.isArray(recommendation.stops) || recommendation.stops.length === 0) {
        throw new Error("AI didn't return any stops for these settings. Nothing was created — adjust the settings and try again, or build the hunt manually.");
      }

      setAiResult(recommendation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleAICreate() {
    if (!aiResult) return;
    if (centerLat === null || centerLng === null) {
      setError("Set where this hunt takes place on the map first. The AI picks the challenges, but it doesn't know your location — the stops are placed around the point you choose so you can move each one to its real spot.");
      return;
    }
    setLoading(true);
    setError("");
    setPartialHuntId(null);

    let huntId: string | null = null;
    let stopsCreated = 0;

    try {
      // 1. Create the hunt
      const huntData = await postJson("/api/v1/hunts", {
        title: aiResult.title,
        description: aiResult.description,
        target_audience: gradeBandFor(aiGradeBand).audience,
        grade_range_min: gradeBandFor(aiGradeBand).range.min,
        grade_range_max: gradeBandFor(aiGradeBand).range.max,
        play_mode: "solo",
        identity_mode: "codename_assigned",
        estimated_duration_min: parseInt(aiDuration),
        center_latitude: centerLat,
        center_longitude: centerLng,
        theme: aiTheme || null,
        theme_narrative: aiResult.theme_narrative || null,
        difficulty_progression: aiDifficulty,
        subject_domains: aiSubjects,
      }, "Failed to create hunt");
      if (!huntData?.hunt?.id) throw new Error("Failed to create hunt: the server returned no hunt");
      huntId = huntData.hunt.id as string;

      // 2. Create finds for each AI-recommended stop
      const total = aiResult.stops.length;
      for (const [index, stop] of aiResult.stops.entries()) {
        // Placeholder position near the hunt center; the creator moves it to the real spot.
        const locData = await postJson("/api/v1/locations", {
          name: `Stop ${index + 1} (needs placement)`,
          ...placeholderPosition(centerLat, centerLng, index, total),
          radius_meters: 50,
          location_type: aiLocationType,
        }, `Failed to create a location for stop ${index + 1}`);
        if (!locData?.location?.id) throw new Error(`Failed to create a location for stop ${index + 1}`);

        // Create the find linking task, primer, location, and clue
        await postJson(`/api/v1/hunts/${huntId}/finds`, {
          location_id: locData.location.id,
          task_id: stop.task_id,
          primer_id: stop.primer_id || null,
          clue_text: stop.suggested_clue,
          clue_hints: stop.clue_hints || [],
          sort_order: index,
          hot_cold_enabled: true,
          metadata: { needs_placement: true, generated_by: "ai" },
        }, `Failed to add stop ${index + 1}`);
        stopsCreated++;
      }

      router.push(`/dashboard/hunts/${huntId}`);
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Failed to create hunt";
      if (huntId) {
        // The hunt exists but is incomplete — say so rather than pretending either way.
        setPartialHuntId(huntId);
        setError(`The hunt was created as a draft, but only ${stopsCreated} of ${aiResult.stops.length} stops could be added. ${reason}`);
      } else {
        setError(reason);
      }
      setLoading(false);
    }
  }

  function toggleSubject(subject: string) {
    setAiSubjects((prev) =>
      prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="text-lg font-semibold text-gray-900 mb-4">Create New Hunt</h1>

      {/* Quick Start Presets */}
      <div className="mb-5">
        <p className="text-xs font-medium text-gray-500 mb-2">Quick Start — choose a preset</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {HUNT_PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => applyPreset(preset)}
              className={`text-left rounded-lg border p-2.5 transition hover:shadow-sm ${
                selectedPreset?.key === preset.key
                  ? preset.color + " ring-2 ring-offset-1 ring-sky-400"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <span className="text-lg">{preset.icon}</span>
              <p className="text-xs font-medium text-gray-900 mt-0.5">{preset.name}</p>
              <p className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{preset.description}</p>
            </button>
          ))}
        </div>
        {selectedPreset && (
          <p className="text-xs text-sky-600 mt-2">
            Using <strong>{selectedPreset.name}</strong> preset — it filled in Audience, Play Mode and Leaderboard Identity below (change them if you like) and sets its scoring options.
            <button onClick={() => setSelectedPreset(null)} className="ml-2 text-gray-400 hover:text-gray-600">Clear</button>
          </p>
        )}
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => { setMode("manual"); setAiResult(null); }}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            mode === "manual"
              ? "bg-sky-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Build Manually
        </button>
        <button
          onClick={() => setMode("ai")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
            mode === "ai"
              ? "bg-violet-600 text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Build with AI
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700 mb-4">
          {error}
          {partialHuntId && (
            <>
              {" "}
              <Link href={`/dashboard/hunts/${partialHuntId}`} className="font-medium underline">
                Open the draft to finish it by hand
              </Link>
              .
            </>
          )}
        </div>
      )}

      {/* ── MANUAL MODE ── */}
      {mode === "manual" && (
        <form onSubmit={handleManualSubmit} className="space-y-5">
          <div>
            <label htmlFor="title" className="block text-sm font-medium text-gray-700">Hunt Title</label>
            <input id="title" name="title" required className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" placeholder="e.g. BYU Campus Discovery Walk" />
          </div>
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700">Description</label>
            <textarea id="description" name="description" rows={3} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" placeholder="Describe what players will experience..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="target_audience" className="block text-sm font-medium text-gray-700">Audience</label>
              <select id="target_audience" name="target_audience" value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="all">All</option>
                <option value="kids">Kids (under 13)</option>
                <option value="teens">Teens (13-17)</option>
                <option value="adults">Adults / College (18+)</option>
                <option value="family">Family</option>
              </select>
            </div>
            <div>
              <label htmlFor="play_mode" className="block text-sm font-medium text-gray-700">Play Mode</label>
              <select id="play_mode" name="play_mode" value={playMode} onChange={(e) => setPlayMode(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="solo">Solo</option>
                <option value="team_self_select">Teams (self-select)</option>
                <option value="team_random">Teams (random)</option>
                <option value="team_assigned">Teams (assigned)</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="identity_mode" className="block text-sm font-medium text-gray-700">Leaderboard Identity</label>
            <select id="identity_mode" name="identity_mode" value={identityMode} onChange={(e) => setIdentityMode(e.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="codename_assigned">Random Codenames (default, most private)</option>
              <option value="codename_chosen">Player-Chosen Names</option>
              <option value="real_name">Real Names</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">Controls how players appear on leaderboards. With Real Names, players under 18 appear by their initials only.</p>
          </div>
          <div>
            <label htmlFor="duration" className="block text-sm font-medium text-gray-700">Estimated Duration (minutes)</label>
            <input id="duration" name="duration" type="number" min={5} className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500" placeholder="30" />
          </div>
          <div>
            <button
              type="button"
              onClick={() => setShowCenterPicker(!showCenterPicker)}
              className="text-sm text-sky-600 hover:underline"
            >
              {showCenterPicker ? "Hide" : "Set"} hunt location on map
              {centerLat !== null ? ` (${centerLat.toFixed(4)}, ${centerLng?.toFixed(4)})` : " (optional)"}
            </button>
            {showCenterPicker && (
              <div className="mt-2 rounded-lg border border-gray-200 p-3">
                <p className="text-xs text-gray-500 mb-2">Click the map or search for an address to set the hunt center point.</p>
                <LocationPicker
                  latitude={centerLat}
                  longitude={centerLng}
                  radiusMeters={5000}
                  onLocationChange={(lat, lng) => {
                    setCenterLat(lat);
                    setCenterLng(lng);
                  }}
                />
              </div>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-6 py-2 text-sm font-medium disabled:opacity-50">
              {loading ? "Creating..." : "Create Hunt"}
            </button>
            <button type="button" onClick={() => router.back()} className="rounded-md border border-gray-300 px-6 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      {/* ── AI MODE ── */}
      {mode === "ai" && !aiResult && (
        <div className="space-y-5">
          <div className="rounded-lg bg-violet-50 border border-violet-200 p-4">
            <p className="text-sm text-violet-800">Tell us what kind of hunt you want and AI will compose it from the content library — picking primers, tasks, and clues for your needs. It does not know your site: you choose where the hunt takes place, and then move each stop to its real spot.</p>
          </div>

          {/* Subject selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Subjects</label>
            <div className="flex flex-wrap gap-2">
              {SUBJECTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => toggleSubject(s.value)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                    aiSubjects.includes(s.value)
                      ? "bg-violet-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Who's playing */}
          <div>
            <label htmlFor="ai_grade_band" className="block text-sm font-medium text-gray-700 mb-1">Who&apos;s playing?</label>
            <select id="ai_grade_band" value={aiGradeBand} onChange={(e) => setAiGradeBand(e.target.value)} className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              {GRADE_BANDS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </div>

          {/* Location type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location Type</label>
            <select value={aiLocationType} onChange={(e) => setAiLocationType(e.target.value)} className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              {LOCATION_TYPES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Number of Stops</label>
              <input type="number" value={aiStops} onChange={(e) => setAiStops(e.target.value)} min={3} max={8} className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target Duration (min)</label>
              <input type="number" value={aiDuration} onChange={(e) => setAiDuration(e.target.value)} min={15} max={120} className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>

          {/* Difficulty progression */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Difficulty Progression</label>
            <select value={aiDifficulty} onChange={(e) => setAiDifficulty(e.target.value)} className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="ascending">Easy to Hard</option>
              <option value="descending">Hard to Easy</option>
              <option value="mixed">Mixed</option>
              <option value="plateau">Consistent Difficulty</option>
            </select>
          </div>

          {/* Theme (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Theme <span className="text-gray-400 font-normal">(optional)</span></label>
            <input value={aiTheme} onChange={(e) => setAiTheme(e.target.value)} placeholder="e.g. campus history mystery, heist, nature detective..." className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500" />
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleAIGenerate} disabled={loading || aiSubjects.length === 0} className="rounded-md bg-violet-600 px-6 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {loading ? "Generating..." : "Generate Hunt"}
            </button>
            <button type="button" onClick={() => router.back()} className="rounded-md border border-gray-300 px-6 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      {/* ── AI RESULT PREVIEW ── */}
      {mode === "ai" && aiResult && (
        <div className="space-y-5">
          <div className="rounded-lg bg-violet-50 border border-violet-200 p-4">
            <h2 className="font-semibold text-violet-900">{aiResult.title}</h2>
            <p className="text-sm text-violet-800 mt-1">{aiResult.description}</p>
            {aiResult.theme_narrative && (
              <p className="text-xs text-violet-600 mt-2 italic">{aiResult.theme_narrative}</p>
            )}
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-900">Where does this hunt take place?</p>
            <p className="text-xs text-amber-800 mt-1 mb-2">
              Required. The AI chose the challenges but can&apos;t choose real-world positions. Each stop will be dropped
              near this point and marked &ldquo;needs placement&rdquo; — you&apos;ll move every stop to its real location before publishing.
            </p>
            <LocationPicker
              latitude={centerLat}
              longitude={centerLng}
              radiusMeters={PLACEHOLDER_RING_METERS}
              onLocationChange={(lat, lng) => {
                setCenterLat(lat);
                setCenterLng(lng);
              }}
            />
          </div>

          <h3 className="text-sm font-semibold text-gray-900">{aiResult.stops.length} Stops</h3>

          <div className="space-y-3">
            {aiResult.stops.map((stop, i) => (
              <div key={i} className="flex gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-sm font-medium text-violet-700">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-600">{stop.suggested_clue}</p>
                  {stop.clue_hints.length > 0 && (
                    <p className="text-xs text-gray-400 mt-1">{stop.clue_hints.length} clue hints included</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 pt-2">
            <button onClick={handleAICreate} disabled={loading || centerLat === null || centerLng === null} className="rounded-md bg-violet-600 px-6 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50">
              {loading ? "Creating..." : "Create This Hunt"}
            </button>
            <button onClick={handleAIGenerate} disabled={loading} className="rounded-md border border-violet-300 px-6 py-2 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50">
              Regenerate
            </button>
            <button onClick={() => setAiResult(null)} className="rounded-md border border-gray-300 px-6 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Edit Settings
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
