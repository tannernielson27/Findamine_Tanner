"use client";

import { useState } from "react";
import LocationPicker from "@/components/maps/location-picker";
import CurriculumBrowser from "./curriculum-browser";
import StandardsBrowser from "./standards-browser";
import AiPromptTemplates from "./ai-prompt-templates";
import AiModeIndicator, { detectMode, type AiMode } from "./ai-mode-indicator";
import { gradeRangeForAudience } from "@/lib/utils/grade-bands";
import { MAX_SAFETY_NOTES_LENGTH } from "@/lib/play/safety";

/** An existing stop, as returned by GET /api/v1/hunts/{id} (finds with their relations). */
export interface EditableFind {
  id: string;
  clue_text: string | null;
  scaffolding_level?: string | null;
  metadata?: Record<string, unknown> | null;
  location_id: string | null;
  task_id: string | null;
  primer_id: string | null;
  locations: { name: string; latitude: number; longitude: number; radius_meters?: number | null; safety_notes?: string | null } | null;
  tasks: {
    title: string;
    challenge_type: string;
    content?: Record<string, unknown> | null;
    is_library?: boolean | null;
    description?: string | null;
    subject_domain?: string | null;
    grade_range_min?: number | null;
    grade_range_max?: number | null;
    difficulty_level?: number | null;
    feedback?: Record<string, unknown> | null;
  } | null;
  primers: { title: string; content?: Record<string, unknown> | null } | null;
}

interface FindEditorProps {
  huntId: string;
  /** The hunt's target audience; AI clues are pitched at it. */
  audience?: string;
  onSaved: () => void;
  onCancel: () => void;
  /** When set, the form edits this stop instead of adding a new one. */
  find?: EditableFind;
  experimentCondition?: string; // "control" | "scaffolding" | "feedback" | "full"
}

const MIN_RADIUS_METERS = 5;
const MAX_RADIUS_METERS = 1000;

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v) => typeof v === "string") ? (value as string[]) : null;
}

/** Read the server's error message off a failed response, with a fallback. */
async function errorFrom(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => null);
  return data?.error ? `${fallback}: ${data.error}` : `${fallback} (error ${res.status})`;
}

const CHALLENGE_TYPES = [
  { value: "multiple_choice", label: "Multiple Choice" },
  { value: "numeric_entry", label: "Numeric Entry" },
  { value: "short_text", label: "Short Text" },
  { value: "creative_writing", label: "Creative Writing" },
  { value: "sorting_ordering", label: "Sorting / Ordering" },
  { value: "photo_observation", label: "Photo Observation" },
  { value: "data_collection", label: "Data Collection" },
  { value: "team_debate", label: "Team Debate" },
];

/**
 * Form to create a new find (stop) within a hunt, or edit an existing one.
 * Creates location + task + find in sequence via API calls.
 *
 * Editing never modifies a location/task/primer row in place: cloned hunts share
 * those rows with the hunt they were copied from, so a changed part is saved as
 * a new row and the stop is re-pointed at it.
 */
export default function FindEditor({ huntId, audience, onSaved, onCancel, find, experimentCondition }: FindEditorProps) {
  const isEdit = !!find;
  const existingContent = (find?.tasks?.content || {}) as Record<string, unknown>;
  const existingPrimerText = typeof find?.primers?.content?.text === "string" ? find.primers.content.text : "";
  // Experiment: scaffolding features only show for scaffolding/full conditions
  const showScaffolding = !experimentCondition || experimentCondition === "scaffolding" || experimentCondition === "full";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showLibrary, setShowLibrary] = useState(false);
  // A library task is used as-is (its fields are read-only below).
  const [libraryTaskId, setLibraryTaskId] = useState<string | null>(
    find?.tasks?.is_library ? find.task_id : null
  );

  // Location fields
  const [locationName, setLocationName] = useState(find?.locations?.name || "");
  const [latitude, setLatitude] = useState(find?.locations ? String(find.locations.latitude) : "");
  const [longitude, setLongitude] = useState(find?.locations ? String(find.locations.longitude) : "");
  const [radiusMeters, setRadiusMeters] = useState(String(find?.locations?.radius_meters ?? 50));
  const [safetyNotes, setSafetyNotes] = useState(find?.locations?.safety_notes || "");

  // Stop settings
  const [scaffoldingLevel, setScaffoldingLevel] = useState(find?.scaffolding_level || "medium");

  // Clue
  const [clueText, setClueText] = useState(find?.clue_text || "");

  // Task fields
  const [taskTitle, setTaskTitle] = useState(find?.tasks?.title || "");
  const [challengeType, setChallengeType] = useState(find?.tasks?.challenge_type || "multiple_choice");
  const [question, setQuestion] = useState(typeof existingContent.question === "string" ? existingContent.question : "");
  const [correctAnswer, setCorrectAnswer] = useState(
    typeof existingContent.correct_answer === "string" || typeof existingContent.correct_answer === "number"
      ? String(existingContent.correct_answer)
      : ""
  );

  // Multiple choice options
  const [options, setOptions] = useState(strings(existingContent.options) || ["", "", "", ""]);

  // Sorting items
  const [sortingItems, setSortingItems] = useState(
    strings(existingContent.correct_order) || strings(existingContent.items) || ["", "", ""]
  );

  // Primer (optional)
  const [primerTitle, setPrimerTitle] = useState(find?.primers?.title || "");
  const [primerText, setPrimerText] = useState(existingPrimerText);

  // Snapshots of what was loaded, so an edit only replaces the parts that changed.
  const locationKey = JSON.stringify([locationName, latitude, longitude, radiusMeters, safetyNotes.trim()]);
  const taskKey = JSON.stringify([libraryTaskId, taskTitle, challengeType, question, correctAnswer, options, sortingItems]);
  const primerKey = JSON.stringify([primerTitle, primerText]);
  const [initialKeys] = useState({ location: locationKey, task: taskKey, primer: primerKey });
  const needsPlacement = find?.metadata?.needs_placement === true;

  // AI generation
  const [generatingClue, setGeneratingClue] = useState(false);
  const [generatingModule, setGeneratingModule] = useState(false);
  const [lessonPlanInput, setLessonPlanInput] = useState("");
  const [showLessonPlan, setShowLessonPlan] = useState(false);
  const [showStandards, setShowStandards] = useState(false);
  const [showAiPrompts, setShowAiPrompts] = useState(false);
  const [currentAiMode, setCurrentAiMode] = useState<AiMode | null>(null);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setError("GPS not available on this device");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      },
      (err) =>
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location is off for Findamine. Turn it on in Settings (or your browser's site settings) to place this stop where you're standing, or enter the coordinates yourself."
            : "Couldn't get your location right now. Try again outdoors, or enter the coordinates yourself."
        ),
      { enableHighAccuracy: true }
    );
  };

  const handleGenerateClue = async () => {
    if (!primerText.trim() && !question.trim()) {
      setError("To generate a clue, first write the challenge question or the primer text — the AI builds the clue from them.");
      return;
    }
    setGeneratingClue(true);
    setError("");
    try {
      const res = await fetch("/api/v1/ai/generate-clue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primer_content: primerText ? { text: primerText } : null,
          task_content: question ? { question } : null,
          location_name: locationName || undefined,
          difficulty_tier: "medium",
          grade_min: gradeRangeForAudience(audience)?.min,
          grade_max: gradeRangeForAudience(audience)?.max,
        }),
      });
      if (!res.ok) {
        setError(await errorFrom(res, "No clue was generated"));
        return;
      }
      const data = await res.json().catch(() => null);
      if (typeof data?.clue_text === "string" && data.clue_text.trim()) {
        setClueText(data.clue_text);
      } else {
        setError("No clue was generated: the AI returned an empty answer. Try again, or write the clue yourself.");
      }
    } catch {
      setError("No clue was generated: couldn't reach the server. Check your connection, or write the clue yourself.");
    } finally {
      setGeneratingClue(false);
    }
  };

  const handleGenerateFromLessonPlan = async () => {
    if (!lessonPlanInput.trim()) return setError("Enter a lesson plan or topic");
    setGeneratingModule(true);
    setError("");
    try {
      const res = await fetch("/api/v1/ai/generate-module", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: lessonPlanInput.slice(0, 100),
          lesson_plan_text: lessonPlanInput,
          challenge_type: challengeType,
        }),
      });
      if (!res.ok) {
        setError(await errorFrom(res, "Nothing was generated"));
        return;
      }
      const data = await res.json().catch(() => null);
      if (!data?.primer && !data?.task) {
        setError("Nothing was generated: the AI returned an empty answer. Try again, or write the challenge yourself.");
        return;
      }
      if (data.primer) {
        setPrimerTitle(data.primer.title || "");
        const pc = data.primer.content;
        setPrimerText(typeof pc === "object" ? (pc.text || JSON.stringify(pc)) : String(pc));
      }
      if (data.task) {
        setTaskTitle(data.task.title || "");
        const tc = data.task.content;
        if (tc?.question) setQuestion(tc.question);
        if (tc?.options && challengeType === "multiple_choice") {
          setOptions(tc.options);
          if (tc.correct_answer) setCorrectAnswer(tc.correct_answer);
        }
        if (tc?.items && challengeType === "sorting_ordering") {
          setSortingItems(tc.items);
        }
        if (tc?.correct_answer && !["multiple_choice", "sorting_ordering"].includes(challengeType)) {
          setCorrectAnswer(tc.correct_answer);
        }
      }
      setShowLessonPlan(false);
    } catch {
      setError("Nothing was generated: couldn't reach the server. Check your connection, or write the challenge yourself.");
    } finally {
      setGeneratingModule(false);
    }
  };

  const handleSave = async () => {
    setError("");

    // Validate required fields
    if (!locationName.trim()) return setError("Location name is required");
    if (!latitude || !longitude) return setError("Coordinates are required — click the map, search for an address, or type them in");

    const lat = Number(latitude);
    const lng = Number(longitude);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return setError("Latitude must be a number between -90 and 90");
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) return setError("Longitude must be a number between -180 and 180");

    const radius = Number(radiusMeters);
    if (radiusMeters.trim() === "" || !Number.isFinite(radius) || radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
      return setError(`Arrival radius must be between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS} meters (50 is a good default)`);
    }

    if (!taskTitle.trim()) return setError("Challenge title is required");
    if (!clueText.trim()) return setError("Clue text is required");

    // A library task is used as-is, so only hand-written challenges are checked.
    if (!libraryTaskId && challengeType === "multiple_choice") {
      const filledOptions = options.map((o) => o.trim()).filter(Boolean);
      if (filledOptions.length < 2) return setError("At least 2 answer options are required");
      if (new Set(filledOptions).size !== filledOptions.length) return setError("Two answer options are the same — make each option different");
      if (!correctAnswer.trim() || !filledOptions.includes(correctAnswer.trim())) {
        return setError("Select the correct answer (click the radio button next to one of the options)");
      }
    }

    if (!libraryTaskId && challengeType === "sorting_ordering") {
      const filledItems = sortingItems.filter((i) => i.trim());
      if (filledItems.length < 2) return setError("At least 2 items to sort are required");
    }

    // (An untouched existing primer is kept as-is, whatever shape its content has.)
    if (primerKey !== initialKeys.primer && !!primerTitle.trim() !== !!primerText.trim()) {
      return setError("A primer needs both a title and text — fill in both, or clear both to skip the primer");
    }

    const locationChanged = !isEdit || !find.location_id || locationKey !== initialKeys.location;
    const taskChanged = !isEdit || !find.task_id || taskKey !== initialKeys.task;
    const primerChanged = !isEdit || primerKey !== initialKeys.primer;
    // Only actually moving the pin counts as placing a placeholder stop — renaming it does not.
    const pinMoved =
      isEdit && (Number(find.locations?.latitude) !== lat || Number(find.locations?.longitude) !== lng);

    setSaving(true);

    try {
      // 1. Create location (when editing: only if it changed)
      let locationId = find?.location_id ?? null;
      if (locationChanged) {
        const locRes = await fetch("/api/v1/locations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: locationName.trim(),
            latitude: lat,
            longitude: lng,
            radius_meters: radius,
            safety_notes: safetyNotes.trim() || null,
          }),
        });
        if (!locRes.ok) throw new Error(await errorFrom(locRes, "Failed to save location"));
        const locData = await locRes.json();
        locationId = locData.location?.id ?? null;
        if (!locationId) throw new Error("Failed to save location: the server returned no location");
      }

      // 2. Get or create task
      let taskId = libraryTaskId; // Use library task if selected
      if (!taskId && !taskChanged) taskId = find?.task_id ?? null;

      if (!taskId) {
      // Build task content based on challenge type. When editing a task of the
      // same type, keep the parts of its content this form doesn't show (hints…).
      const sameType = isEdit && !find.tasks?.is_library && find.tasks?.challenge_type === challengeType;
      const content: Record<string, unknown> = { ...(sameType ? existingContent : {}), question };

      if (challengeType === "multiple_choice") {
        content.options = options.map((o) => o.trim()).filter(Boolean);
        content.correct_answer = correctAnswer.trim();
      } else if (challengeType === "numeric_entry") {
        content.correct_answer = correctAnswer;
      } else if (challengeType === "sorting_ordering") {
        content.items = sortingItems.filter((i) => i.trim());
        content.correct_order = sortingItems.filter((i) => i.trim()); // Creator enters in correct order
      } else {
        content.correct_answer = correctAnswer || null;
      }

      // 3. Create task
      const taskRes = await fetch("/api/v1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: taskTitle.trim(),
          challenge_type: challengeType,
          content,
          // Carry over the classification of the task being replaced.
          ...(sameType && find.tasks
            ? {
                description: find.tasks.description ?? undefined,
                subject_domain: find.tasks.subject_domain ?? undefined,
                grade_range_min: find.tasks.grade_range_min ?? undefined,
                grade_range_max: find.tasks.grade_range_max ?? undefined,
                difficulty_level: find.tasks.difficulty_level ?? undefined,
                feedback: find.tasks.feedback ?? undefined,
              }
            : {}),
        }),
      });
      if (!taskRes.ok) throw new Error(await errorFrom(taskRes, "Failed to save challenge"));
      const taskData = await taskRes.json();
      taskId = taskData.record?.id || taskData.task?.id;
      if (!taskId) throw new Error("Failed to save challenge: the server returned no challenge");
      } // end if (!taskId)

      // 4. Optionally create primer (when editing: only if it changed)
      let primerId: string | null = primerChanged ? null : find?.primer_id ?? null;
      if (primerChanged && primerTitle.trim() && primerText.trim()) {
        const primerRes = await fetch("/api/v1/primers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: primerTitle.trim(),
            content: { text: primerText },
          }),
        });
        if (!primerRes.ok) throw new Error(await errorFrom(primerRes, "Failed to save primer"));
        const primerData = await primerRes.json();
        primerId = primerData.record?.id || primerData.primer?.id || null;
        if (!primerId) throw new Error("Failed to save primer: the server returned no primer");
      }

      // 5. Create (or update) the find
      const findRes = await fetch(
        isEdit ? `/api/v1/hunts/${huntId}/finds/${find.id}` : `/api/v1/hunts/${huntId}/finds`,
        {
          method: isEdit ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            location_id: locationId,
            task_id: taskId,
            primer_id: primerId,
            clue_text: clueText,
            scaffolding_level: scaffoldingLevel,
            ...(isEdit
              ? // Moving a placeholder stop is what marks it as placed.
                pinMoved && needsPlacement
                ? { metadata: { ...(find.metadata || {}), needs_placement: false } }
                : {}
              : { hot_cold_enabled: true }),
          }),
        }
      );
      if (!findRes.ok) throw new Error(await errorFrom(findRes, isEdit ? "Failed to save stop" : "Failed to add stop"));

      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-6">
      <h3 className="text-base font-semibold text-gray-900 mb-4">{isEdit ? "Edit Stop" : "Add New Stop"}</h3>

      {error && (
        <div role="alert" className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}

      {needsPlacement && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 mb-4">
          This stop was generated by AI and has a placeholder location near the hunt center. Give it a real name and move the pin to where players should actually go.
        </div>
      )}

      {/* ── Location ── */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-gray-700 mb-2">Location</legend>
        <div className="space-y-3">
          <input
            value={locationName}
            onChange={(e) => setLocationName(e.target.value)}
            placeholder="Location name (e.g. Old Main Fountain)"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              value={latitude}
              onChange={(e) => setLatitude(e.target.value)}
              placeholder="Latitude"
              type="number"
              step="any"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <input
              value={longitude}
              onChange={(e) => setLongitude(e.target.value)}
              placeholder="Longitude"
              type="number"
              step="any"
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <input
              value={radiusMeters}
              onChange={(e) => setRadiusMeters(e.target.value)}
              placeholder="Radius (m)"
              aria-label="Arrival radius in meters"
              type="number"
              min={MIN_RADIUS_METERS}
              max={MAX_RADIUS_METERS}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
          <LocationPicker
            latitude={latitude ? parseFloat(latitude) : null}
            longitude={longitude ? parseFloat(longitude) : null}
            radiusMeters={Number(radiusMeters) > 0 ? Number(radiusMeters) : 50}
            onLocationChange={(lat, lng) => {
              setLatitude(lat.toFixed(6));
              setLongitude(lng.toFixed(6));
            }}
          />
          <button
            type="button"
            onClick={handleUseMyLocation}
            className="text-sm text-sky-600 hover:underline"
          >
            Use my current location
          </button>
          <div>
            <label htmlFor="stop-safety-notes" className="block text-xs text-gray-500 mb-1">
              Safety notes (optional)
            </label>
            <textarea
              id="stop-safety-notes"
              value={safetyNotes}
              onChange={(e) => setSafetyNotes(e.target.value)}
              maxLength={MAX_SAFETY_NOTES_LENGTH}
              rows={2}
              placeholder="e.g. Use the crosswalk at 3rd St. Stay on the path near the pond."
              aria-describedby="stop-safety-notes-help"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
            <p id="stop-safety-notes-help" className="mt-1 text-xs text-gray-500">
              Players see this while walking to the stop. Put pins only on public, safe, accessible ground.
            </p>
          </div>
        </div>
      </fieldset>

      {/* ── Stop Settings ── */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-gray-700 mb-2">Stop Settings</legend>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Scaffolding Level</label>
            <select
              value={scaffoldingLevel}
              onChange={(e) => setScaffoldingLevel(e.target.value)}
              className="block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            >
              <option value="high">High — hints free, full AI, unlimited retries</option>
              <option value="medium">Medium — hints -3pts, 5 retries (default)</option>
              <option value="low">Low — hints -5pts, 2 retries</option>
            </select>
          </div>
        </div>
      </fieldset>

      {/* ── Clue ── */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-gray-700 mb-2">Clue</legend>
        <textarea
          value={clueText}
          onChange={(e) => setClueText(e.target.value)}
          placeholder="Write a clue that leads players to this location..."
          rows={2}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <button
          type="button"
          onClick={handleGenerateClue}
          disabled={generatingClue}
          className="mt-2 text-xs text-violet-600 hover:underline disabled:opacity-50"
        >
          {generatingClue ? "Generating..." : "Generate clue with AI"}
        </button>
      </fieldset>

      {/* ── Curriculum Library Browser ── */}
      {showLibrary && (
        <div className="mb-5">
          <CurriculumBrowser
            onSelect={(task) => {
              setLibraryTaskId(task.id);
              setTaskTitle(task.title);
              setChallengeType(task.challenge_type);
              setQuestion((task.content?.question as string) || "");
              if (task.challenge_type === "multiple_choice" && Array.isArray(task.content?.options)) {
                setOptions(task.content.options as string[]);
                setCorrectAnswer((task.content.correct_answer as string) || "");
              }
              if (task.challenge_type === "sorting_ordering" && Array.isArray(task.content?.items)) {
                setSortingItems(task.content.items as string[]);
              }
              if (!["multiple_choice", "sorting_ordering"].includes(task.challenge_type)) {
                setCorrectAnswer((task.content?.correct_answer as string) || "");
              }
              setShowLibrary(false);
            }}
            onCancel={() => setShowLibrary(false)}
          />
        </div>
      )}

      {/* ── Challenge ── */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
          <span>Challenge</span>
          <span className="flex gap-3">
            {!showLibrary && (
              <button
                type="button"
                onClick={() => setShowLibrary(true)}
                className="text-xs text-sky-600 hover:underline font-normal"
              >
                Browse Library
              </button>
            )}
            {showScaffolding ? (
              <button
                type="button"
                onClick={() => { setShowAiPrompts(!showAiPrompts); setShowLessonPlan(false); }}
                className="text-xs text-violet-600 hover:underline font-normal"
              >
                {showAiPrompts ? "Hide AI" : "AI-Assisted Creation"}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowLessonPlan(!showLessonPlan)}
                className="text-xs text-violet-600 hover:underline font-normal"
              >
                {showLessonPlan ? "Hide" : "Generate with AI"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowStandards(!showStandards)}
              className="text-xs text-emerald-600 hover:underline font-normal"
            >
              {showStandards ? "Hide" : "Browse by Standard"}
            </button>
          </span>
        </legend>
        {showAiPrompts && (
          <div className="mb-3">
            <AiPromptTemplates
              topic={taskTitle || primerTitle || ""}
              onSelectPrompt={(prompt, mode) => {
                setCurrentAiMode(mode);
                setLessonPlanInput(prompt);
                setShowAiPrompts(false);
                setShowLessonPlan(true);
              }}
            />
          </div>
        )}

        {showLessonPlan && (
          <div className="rounded-lg bg-violet-50 border border-violet-200 p-4 mb-3">
            {showScaffolding && currentAiMode && (
              <div className="mb-2">
                <AiModeIndicator mode={currentAiMode} compact />
              </div>
            )}
            <textarea
              value={lessonPlanInput}
              onChange={(e) => {
                setLessonPlanInput(e.target.value.slice(0, 5000));
                if (showScaffolding) setCurrentAiMode(detectMode(e.target.value));
              }}
              maxLength={5000}
              placeholder="Describe what you want to teach, paste a lesson plan, or ask AI to help you improve your draft..."
              rows={4}
              className="block w-full rounded-md border border-violet-300 px-3 py-2 text-sm mb-2 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-violet-400">{lessonPlanInput.length}/5000</p>
              <button
                type="button"
                onClick={handleGenerateFromLessonPlan}
                disabled={generatingModule}
                className="rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {generatingModule ? "Generating..." : "Generate with AI"}
              </button>
            </div>
          </div>
        )}

        {showStandards && (
          <div className="mb-3">
            <StandardsBrowser
              onSelectTask={(task) => {
                setLibraryTaskId(task.id);
                setTaskTitle(task.title);
                setChallengeType(task.challenge_type);
                setShowStandards(false);
              }}
              onCancel={() => setShowStandards(false)}
            />
          </div>
        )}

        {libraryTaskId && (
          <div className="rounded-md bg-sky-50 border border-sky-200 px-3 py-2 mb-3 flex items-center justify-between">
            <span className="text-xs text-sky-700">Using library task: <strong>{taskTitle}</strong> — it is used exactly as written, so the fields below are read-only. Clear it to write your own challenge.</span>
            <button
              type="button"
              onClick={() => { setLibraryTaskId(null); setTaskTitle(""); setQuestion(""); setChallengeType("multiple_choice"); }}
              className="text-xs text-sky-500 hover:text-sky-700"
            >
              Clear
            </button>
          </div>
        )}
        <fieldset disabled={!!libraryTaskId} className="space-y-3 disabled:opacity-60">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Challenge title"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />

          <select
            value={challengeType}
            onChange={(e) => setChallengeType(e.target.value)}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            {CHALLENGE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Question text"
            rows={2}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />

          {/* Multiple choice options */}
          {challengeType === "multiple_choice" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Answer options (click the radio to mark the correct one):</p>
              {options.map((opt, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="correct_option"
                    checked={correctAnswer === opt && opt !== ""}
                    onChange={() => setCorrectAnswer(opt)}
                    className="accent-sky-600"
                  />
                  <input
                    value={opt}
                    onChange={(e) => {
                      const next = [...options];
                      next[idx] = e.target.value;
                      setOptions(next);
                      if (correctAnswer === opt) setCorrectAnswer(e.target.value);
                    }}
                    placeholder={`Option ${String.fromCharCode(65 + idx)}`}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  {options.length > 2 && (
                    <button
                      type="button"
                      onClick={() => {
                        setOptions(options.filter((_, i) => i !== idx));
                        // Removing the option marked correct must not leave it as the answer.
                        if (correctAnswer === opt) setCorrectAnswer("");
                      }}
                      className="text-gray-500 hover:text-red-500 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {options.length < 6 && (
                <button
                  onClick={() => setOptions([...options, ""])}
                  className="text-xs text-sky-600 hover:underline"
                >
                  + Add option
                </button>
              )}
            </div>
          )}

          {/* Sorting items */}
          {challengeType === "sorting_ordering" && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">Enter items in the correct order (they will be shuffled for players):</p>
              {sortingItems.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-5">{idx + 1}.</span>
                  <input
                    value={item}
                    onChange={(e) => {
                      const next = [...sortingItems];
                      next[idx] = e.target.value;
                      setSortingItems(next);
                    }}
                    placeholder={`Item ${idx + 1}`}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                  {sortingItems.length > 2 && (
                    <button
                      onClick={() => setSortingItems(sortingItems.filter((_, i) => i !== idx))}
                      className="text-gray-500 hover:text-red-500 text-xs"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {sortingItems.length < 8 && (
                <button
                  onClick={() => setSortingItems([...sortingItems, ""])}
                  className="text-xs text-sky-600 hover:underline"
                >
                  + Add item
                </button>
              )}
            </div>
          )}

          {/* Correct answer for non-MC types */}
          {!["multiple_choice", "sorting_ordering"].includes(challengeType) && (
            <input
              value={correctAnswer}
              onChange={(e) => setCorrectAnswer(e.target.value)}
              placeholder="Correct answer (or leave blank for open-ended)"
              className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          )}
        </fieldset>
      </fieldset>

      {/* ── Primer (optional) ── */}
      <fieldset className="mb-5">
        <legend className="text-sm font-medium text-gray-700 mb-2">
          Primer <span className="text-gray-500 font-normal">(optional)</span>
        </legend>
        <div className="space-y-3">
          <input
            value={primerTitle}
            onChange={(e) => setPrimerTitle(e.target.value)}
            placeholder="Primer title (e.g. About Photosynthesis)"
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
          <textarea
            value={primerText}
            onChange={(e) => setPrimerText(e.target.value)}
            placeholder="Educational content shown before the challenge..."
            rows={3}
            className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </div>
      </fieldset>

      {/* ── Actions ── */}
      {error && (
        <p role="alert" className="text-sm text-red-700 mb-2">{error}</p>
      )}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Save Stop"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="rounded-md border border-gray-300 px-5 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
