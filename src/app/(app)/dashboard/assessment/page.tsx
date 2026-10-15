"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NETWORK_ERROR_MESSAGE, postJson } from "@/app/login/auth-client";
import { ALL_ITEMS, type Scores } from "@/app/api/v1/assessments/scoring";

const SCALE_LABELS = [
  "Disagree strongly",
  "Disagree",
  "Disagree a little",
  "Neither agree nor disagree",
  "Agree a little",
  "Agree",
  "Agree strongly",
];

const DIMENSION_LABELS: Record<string, { label: string; highDesc: string; lowDesc: string; color: string }> = {
  openness: { label: "Openness", highDesc: "Curious & creative", lowDesc: "Practical & focused", color: "bg-violet-500" },
  conscientiousness: { label: "Conscientiousness", highDesc: "Organized & reliable", lowDesc: "Flexible & spontaneous", color: "bg-sky-500" },
  extraversion: { label: "Extraversion", highDesc: "Outgoing & energetic", lowDesc: "Reflective & reserved", color: "bg-amber-500" },
  agreeableness: { label: "Agreeableness", highDesc: "Cooperative & trusting", lowDesc: "Analytical & direct", color: "bg-emerald-500" },
  // Saved and scored as neuroticism (anxious = high). The profile shows the
  // friendlier inverse, so the bar is flipped with displayScore() below.
  neuroticism: { label: "Emotional Stability", highDesc: "Calm & resilient", lowDesc: "Sensitive & aware", color: "bg-rose-500" },
  growth_mindset: { label: "Growth Mindset", highDesc: "Believes abilities can grow", lowDesc: "Believes abilities are fixed", color: "bg-teal-500" },
};

// Dimensions whose label describes the opposite pole of the stored score.
const INVERTED_FOR_DISPLAY = new Set(["neuroticism"]);

/** Score as shown next to a dimension's label, on the same 1-7 scale. Display only. */
function displayScore(dimension: string, score: number): number {
  return INVERTED_FOR_DISPLAY.has(dimension) ? Math.round((8 - score) * 10) / 10 : score;
}

interface SavedAssessment {
  scores: Scores;
  assessed_at: string | null;
}

type View = "loading" | "form" | "results";

const EMPTY_RESPONSES: (number | null)[] = new Array(ALL_ITEMS.length).fill(null);

const PRIMARY_BUTTON =
  "inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg disabled:opacity-50";

export default function AssessmentPage() {
  const [view, setView] = useState<View>("loading");
  const [responses, setResponses] = useState<(number | null)[]>(EMPTY_RESPONSES);
  const [saved, setSaved] = useState<SavedAssessment | null>(null);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const loadSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/assessments");
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { assessment: SavedAssessment | null };
      setSaved(data.assessment);
      setView(data.assessment ? "results" : "form");
    } catch (err) {
      // The form still works; say that earlier results could not be checked.
      setLoadError(
        err instanceof TypeError
          ? NETWORK_ERROR_MESSAGE
          : "We couldn't check for your saved results. You can still take the assessment."
      );
      setView("form");
    }
  }, []);

  useEffect(() => {
    void loadSaved();
  }, [loadSaved]);

  function retryLoad() {
    setLoadError("");
    setView("loading");
    void loadSaved();
  }

  const remaining = responses.filter((r) => r === null).length;

  async function handleSubmit() {
    if (remaining > 0 || saving) return;
    setSaving(true);
    setSaveError("");
    const result = await postJson(
      "/api/v1/assessments",
      { responses },
      "We couldn't save your results. Please try again."
    );
    setSaving(false);
    if (!result.ok) {
      // Answers stay on screen so nothing has to be re-entered.
      setSaveError(result.error);
      return;
    }
    setSaved(result.data.assessment as SavedAssessment);
    setResponses(EMPTY_RESPONSES);
    setView("results");
  }

  if (view === "loading") {
    return (
      <main className="mx-auto max-w-2xl px-4 py-4" aria-busy="true">
        <p className="sr-only" role="status">Loading your assessment</p>
        <div className="fm-shimmer space-y-3">
          <div className="h-6 w-1/2 rounded bg-themed-border" />
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-lg bg-themed-border" />)}
        </div>
      </main>
    );
  }

  if (view === "results" && saved) {
    const savedOn = saved.assessed_at ? new Date(saved.assessed_at).toLocaleDateString() : null;
    return (
      <main className="mx-auto max-w-2xl px-4 py-4">
        <h1 className="mb-1 font-[family-name:var(--font-display)] text-xl font-bold text-themed-text">
          Your Personality Profile
        </h1>
        <p className="mb-4 text-sm text-themed-muted">
          Based on the TIPI (Big 5) and Growth Mindset Scale (Dweck)
        </p>

        <div className="mb-6 space-y-4">
          {Object.entries(DIMENSION_LABELS).map(([key, dim]) => {
            const raw = saved.scores[key];
            if (typeof raw !== "number") return null;
            const score = displayScore(key, raw);
            const pct = Math.round(((score - 1) / 6) * 100);
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-sm font-medium text-themed-text">{dim.label}</span>
                  <span className="text-sm tabular-nums text-themed-muted">{score}/7</span>
                </div>
                <div
                  className="h-3 w-full overflow-hidden rounded-full bg-themed-border"
                  role="img"
                  aria-label={`${dim.label}: ${score} out of 7`}
                >
                  <div className={`h-3 rounded-full ${dim.color}`} style={{ width: `${Math.max(pct, 5)}%` }} />
                </div>
                <div className="mt-0.5 flex justify-between text-xs text-themed-muted">
                  <span>{dim.lowDesc}</span>
                  <span>{dim.highDesc}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div role="status" className="mb-4 rounded-lg border border-themed-border bg-themed-bg p-3">
          <p className="text-sm text-themed-text">
            <strong>Saved{savedOn ? ` on ${savedOn}` : ""}.</strong> An instructor running one of your
            hunts can use these results to form balanced teams. Who else can see them is up to you:
            it&apos;s the Personality Profile setting in{" "}
            <Link href="/settings/privacy" className="font-medium text-link underline hover:text-link-dark">
              your privacy settings
            </Link>
            .
          </p>
        </div>

        <button
          type="button"
          onClick={() => { setSaveError(""); setResponses(EMPTY_RESPONSES); setView("form"); }}
          className={SECONDARY_BUTTON}
        >
          Retake assessment
        </button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="mb-1 font-[family-name:var(--font-display)] text-xl font-bold text-themed-text">
        Personality Assessment
      </h1>
      <p className="mb-4 text-sm text-themed-muted">
        Rate how well each statement describes you. There are no right or wrong answers — just be
        honest. This takes about 2 minutes. Your results are saved to your profile when you finish
        {saved ? " and replace your earlier results." : "."}
      </p>

      {loadError && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-themed-border bg-themed-bg p-3">
          <p className="text-sm text-[var(--color-error)]">{loadError}</p>
          <button type="button" onClick={retryLoad} className={SECONDARY_BUTTON}>
            Try again
          </button>
        </div>
      )}

      <div className="mb-6 space-y-4">
        {ALL_ITEMS.map((item, i) => (
          <div
            key={i}
            role="group"
            aria-labelledby={`assessment-item-${i}`}
            className="rounded-lg border border-themed-border bg-surface p-3"
          >
            <p id={`assessment-item-${i}`} className="mb-2 text-base text-themed-text">
              {i + 1}. {item.text}
            </p>
            <div className="flex gap-1">
              {SCALE_LABELS.map((label, j) => (
                <button
                  key={j}
                  type="button"
                  aria-pressed={responses[i] === j + 1}
                  aria-label={`${j + 1}: ${label}`}
                  title={label}
                  disabled={saving}
                  onClick={() => setResponses((prev) => prev.map((r, k) => (k === i ? j + 1 : r)))}
                  className={`min-h-11 flex-1 rounded-md text-sm font-medium tabular-nums transition-colors ${
                    responses[i] === j + 1
                      ? "bg-brand text-white"
                      : "border border-themed-border bg-themed-bg text-themed-text hover:bg-surface"
                  }`}
                >
                  {j + 1}
                </button>
              ))}
            </div>
            <div className="mt-1 flex justify-between px-1 text-xs text-themed-muted">
              <span>Disagree</span>
              <span>Agree</span>
            </div>
          </div>
        ))}
      </div>

      {saveError && (
        <p role="alert" className="mb-3 text-sm font-medium text-[var(--color-error)]">
          {saveError} Your answers are still here.
        </p>
      )}

      <button type="button" onClick={handleSubmit} disabled={remaining > 0 || saving} className={PRIMARY_BUTTON}>
        {saving ? "Saving..." : remaining > 0 ? `Answer ${remaining} more to finish` : "Save and see my results"}
      </button>

      {saved && (
        <button
          type="button"
          onClick={() => { setSaveError(""); setView("results"); }}
          disabled={saving}
          className={`${SECONDARY_BUTTON} mt-3 w-full`}
        >
          Keep my earlier results
        </button>
      )}
    </main>
  );
}
