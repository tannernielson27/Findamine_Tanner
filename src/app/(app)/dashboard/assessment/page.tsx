"use client";

import { useState } from "react";

// TIPI (Ten Item Personality Inventory) — validated short Big 5 measure
const TIPI_ITEMS = [
  { text: "I see myself as extraverted, enthusiastic", dimension: "extraversion", direction: 1 },
  { text: "I see myself as critical, quarrelsome", dimension: "agreeableness", direction: -1 },
  { text: "I see myself as dependable, self-disciplined", dimension: "conscientiousness", direction: 1 },
  { text: "I see myself as anxious, easily upset", dimension: "neuroticism", direction: 1 },
  { text: "I see myself as open to new experiences, complex", dimension: "openness", direction: 1 },
  { text: "I see myself as reserved, quiet", dimension: "extraversion", direction: -1 },
  { text: "I see myself as sympathetic, warm", dimension: "agreeableness", direction: 1 },
  { text: "I see myself as disorganized, careless", dimension: "conscientiousness", direction: -1 },
  { text: "I see myself as calm, emotionally stable", dimension: "neuroticism", direction: -1 },
  { text: "I see myself as conventional, uncreative", dimension: "openness", direction: -1 },
];

// Growth Mindset Scale — 4 items (adapted from Dweck, 2006)
const GROWTH_MINDSET_ITEMS = [
  { text: "Your intelligence is something very basic about you that you can't change very much", dimension: "growth_mindset", direction: -1 },
  { text: "No matter how much intelligence you have, you can always change it quite a bit", dimension: "growth_mindset", direction: 1 },
  { text: "You can learn new things, but you can't really change how intelligent you are", dimension: "growth_mindset", direction: -1 },
  { text: "You can always substantially change how intelligent you are", dimension: "growth_mindset", direction: 1 },
];

const ALL_ITEMS = [...TIPI_ITEMS, ...GROWTH_MINDSET_ITEMS];

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
  // Items are scored toward neuroticism (anxious = high). The profile shows the
  // friendlier inverse, so the bar is flipped with displayScore() below.
  neuroticism: { label: "Emotional Stability", highDesc: "Calm & resilient", lowDesc: "Sensitive & aware", color: "bg-rose-500" },
  growth_mindset: { label: "Growth Mindset", highDesc: "Believes abilities can grow", lowDesc: "Believes abilities are fixed", color: "bg-teal-500" },
};

// Dimensions whose label describes the opposite pole of the stored score.
const INVERTED_FOR_DISPLAY = new Set(["neuroticism"]);

/** Score as shown next to a dimension's label, on the same 1-7 scale. */
function displayScore(dimension: string, score: number): number {
  return INVERTED_FOR_DISPLAY.has(dimension) ? Math.round((8 - score) * 10) / 10 : score;
}

interface ExistingScores {
  [key: string]: number;
}

export default function AssessmentPage() {
  const [responses, setResponses] = useState<(number | null)[]>(new Array(ALL_ITEMS.length).fill(null));
  const [scores, setScores] = useState<ExistingScores | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function calculateScores(): ExistingScores {
    const dimensionScores: Record<string, number[]> = {};

    ALL_ITEMS.forEach((item, i) => {
      const response = responses[i];
      if (response === null) return;

      if (!dimensionScores[item.dimension]) dimensionScores[item.dimension] = [];

      // Reverse-code negative items (1→7, 2→6, etc.)
      const value = item.direction === 1 ? response : 8 - response;
      dimensionScores[item.dimension].push(value);
    });

    const result: ExistingScores = {};
    for (const [dim, vals] of Object.entries(dimensionScores)) {
      result[dim] = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
    }

    return result;
  }

  function handleSubmit() {
    if (responses.some((r) => r === null)) return;

    // Results are computed in the browser only. There is no endpoint that stores
    // an assessment yet (this used to POST to /api/v1/app-events, which is the
    // admin-only calendar-events API and silently rejected it), so nothing is
    // sent and the results view says plainly that nothing was saved.
    setScores(calculateScores());
    setSubmitted(true);
  }

  const allAnswered = responses.every((r) => r !== null);

  // Results view
  if (submitted && scores) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-4">
        <h1 className="text-base font-bold text-gray-900 mb-1">Your Personality Profile</h1>
        <p className="text-xs text-gray-500 mb-4">Based on the TIPI (Big 5) and Growth Mindset Scale (Dweck)</p>

        <div className="space-y-3 mb-6">
          {Object.entries(DIMENSION_LABELS).map(([key, dim]) => {
            const score = displayScore(key, scores[key] || 4);
            const pct = Math.round(((score - 1) / 6) * 100);
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700">{dim.label}</span>
                  <span className="text-xs text-gray-500">{score}/7</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div className={`h-3 rounded-full ${dim.color} transition-all`} style={{ width: `${Math.max(pct, 5)}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
                  <span>{dim.lowDesc}</span>
                  <span>{dim.highDesc}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div role="status" className="rounded-lg bg-amber-50 border border-amber-200 p-3 mb-4">
          <p className="text-xs text-amber-900">
            <strong>These results were not saved.</strong> They are shown here for you only and will be gone when you leave this page. Saving profiles (and using them to form balanced teams) isn&apos;t available yet.
          </p>
        </div>

        <button
          onClick={() => { setSubmitted(false); setScores(null); setResponses(new Array(ALL_ITEMS.length).fill(null)); }}
          className="text-xs text-sky-600 hover:underline"
        >
          Retake Assessment
        </button>
      </main>
    );
  }

  // Assessment form
  return (
    <main className="mx-auto max-w-2xl px-4 py-4">
      <h1 className="text-base font-bold text-gray-900 mb-1">Personality Assessment</h1>
      <p className="text-xs text-gray-500 mb-4">
        Rate how well each statement describes you. There are no right or wrong answers — just be honest. This takes about 2 minutes. Your answers stay in this browser and are not saved.
      </p>

      <div className="space-y-4 mb-6">
        {ALL_ITEMS.map((item, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-sm text-gray-900 mb-2">
              {i + 1}. {item.text}
            </p>
            <div className="flex gap-1">
              {SCALE_LABELS.map((label, j) => (
                <button
                  key={j}
                  onClick={() => {
                    const next = [...responses];
                    next[i] = j + 1;
                    setResponses(next);
                  }}
                  className={`flex-1 rounded px-1 py-1.5 text-[10px] transition ${
                    responses[i] === j + 1
                      ? "bg-sky-600 text-white"
                      : "bg-gray-50 text-gray-500 hover:bg-gray-100"
                  }`}
                  title={label}
                >
                  {j + 1}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-gray-400 mt-0.5 px-1">
              <span>Disagree</span>
              <span>Agree</span>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={handleSubmit}
        disabled={!allAnswered}
        className="w-full bg-brand text-white rounded-lg hover:bg-brand-dark transition-colors px-6 py-2 text-sm font-medium disabled:opacity-50"
      >
        {allAnswered ? "See My Results" : `Answer all ${ALL_ITEMS.length - responses.filter(r => r !== null).length} remaining`}
      </button>
    </main>
  );
}
