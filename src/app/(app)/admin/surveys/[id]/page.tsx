"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import {
  nextItemCode,
  optionsToText,
  scaleConfigForType,
  textToOptions,
  type ScaleConfig,
} from "@/lib/utils/survey-authoring";

const QUESTION_TYPES = [
  { value: "likert_5", label: "Likert (1–5)" },
  { value: "likert_7", label: "Likert (1–7)" },
  { value: "multiple_choice", label: "Multiple choice" },
  { value: "slider", label: "Slider" },
  { value: "free_text", label: "Free text" },
];

interface EditQ {
  item_code: string;
  question_text: string;
  question_type: string;
  subscale: string;
  reverse_coded: boolean;
  required: boolean;
  scale_config: ScaleConfig;
  /** One option per line; "value | label" keeps a stored label distinct from its value. */
  optionsText: string;
}

interface SurveyMeta {
  id: string;
  title: string;
  description: string | null;
  status: string;
  /** Embedded count from GET /api/v1/surveys/[id]. */
  survey_responses?: { count: number }[] | null;
}

function blankQuestion(existing: EditQ[]): EditQ {
  return {
    item_code: nextItemCode(existing.map((q) => q.item_code.trim())),
    question_text: "",
    question_type: "likert_5",
    subscale: "",
    reverse_coded: false,
    required: true,
    scale_config: { min: 1, max: 5, min_label: "Strongly disagree", max_label: "Strongly agree" },
    optionsText: "",
  };
}

const isScale = (t: string) => t === "likert_5" || t === "likert_7" || t === "slider";

export default function SurveyEditorPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;

  const [meta, setMeta] = useState<SurveyMeta | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<EditQ[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [responseCount, setResponseCount] = useState(0);

  // Browser-level guard (reload, tab close, typing a new URL) for unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /** Guard for in-app links out of the editor. */
  function confirmLeave(e: { preventDefault: () => void }) {
    if (dirty && !window.confirm("You have unsaved changes to this survey. Leave without saving?")) {
      e.preventDefault();
    }
  }

  useEffect(() => {
    if (!surveyId) return;
    const getJson = (url: string) =>
      fetch(url).then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        return body;
      });
    Promise.all([
      getJson(`/api/v1/surveys/${surveyId}`),
      getJson(`/api/v1/surveys/${surveyId}/questions`),
    ])
      .then(([surveyData, qData]) => {
        const survey: SurveyMeta = surveyData.survey;
        setMeta(survey);
        setResponseCount(survey.survey_responses?.[0]?.count ?? 0);
        setTitle(survey.title);
        setDescription(survey.description ?? "");
        const loaded: EditQ[] = (qData.questions || []).map((q: Record<string, unknown>) => ({
          item_code: String(q.item_code ?? ""),
          question_text: String(q.question_text ?? ""),
          question_type: String(q.question_type ?? "likert_5"),
          subscale: q.subscale ? String(q.subscale) : "",
          reverse_coded: Boolean(q.reverse_coded),
          required: q.required === undefined ? true : Boolean(q.required),
          scale_config: (q.scale_config as ScaleConfig) || {},
          optionsText: optionsToText(q.options),
        }));
        setQuestions(loaded);
      })
      // Don't fall back to an empty editor: saving it would wipe the real questions.
      .catch((err: Error) => setLoadError(`Could not load this survey: ${err.message}`));
  }, [surveyId]);

  function update(i: number, patch: Partial<EditQ>) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[i] = { ...next[i], ...patch };
      return next;
    });
    setMessage(null);
    setDirty(true);
  }

  function updateScale(i: number, patch: Partial<ScaleConfig>) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[i] = { ...next[i], scale_config: { ...next[i].scale_config, ...patch } };
      return next;
    });
    setDirty(true);
  }

  function changeType(i: number, questionType: string) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[i] = {
        ...next[i],
        question_type: questionType,
        scale_config: scaleConfigForType(questionType, next[i].scale_config),
      };
      return next;
    });
    setMessage(null);
    setDirty(true);
  }

  function addQuestion() {
    setQuestions((prev) => [...(prev || []), blankQuestion(prev || [])]);
    setDirty(true);
  }

  function removeQuestion(i: number) {
    const q = questions?.[i];
    if (!q) return;
    const name = q.item_code.trim() || `Q${i + 1}`;
    const text = q.question_text.trim();
    const warning =
      responseCount > 0
        ? `

This survey already has ${responseCount} response${responseCount === 1 ? "" : "s"}; answers stored under "${name}" will no longer map to a question.`
        : "";
    if (!window.confirm(`Delete question ${name}${text ? ` ("${text.slice(0, 80)}")` : ""}?${warning}`)) return;
    setQuestions((prev) => (prev ? prev.filter((_, idx) => idx !== i) : prev));
    setDirty(true);
  }

  function move(i: number, dir: -1 | 1) {
    setQuestions((prev) => {
      if (!prev) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  async function saveDetails(): Promise<string | null> {
    if (!meta) return null;
    const nextDescription = description.trim() || null;
    if (title.trim() === meta.title && nextDescription === (meta.description ?? null)) return null;
    if (!title.trim()) return "Title is required.";
    const res = await fetch(`/api/v1/surveys/${surveyId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), description: nextDescription }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return body.error || "Failed to save title and description.";
    setMeta(body.survey);
    return null;
  }

  async function save() {
    if (!questions) return;
    setSaving(true);
    setMessage(null);
    const detailsError = await saveDetails();
    if (detailsError) {
      setSaving(false);
      setMessage({ kind: "err", text: detailsError });
      return;
    }
    const payload = {
      questions: questions.map((q) => ({
        item_code: q.item_code.trim(),
        question_text: q.question_text.trim(),
        question_type: q.question_type,
        subscale: q.subscale.trim() || null,
        reverse_coded: q.reverse_coded,
        required: q.required,
        scale_config: isScale(q.question_type) ? q.scale_config : {},
        options: q.question_type === "multiple_choice" ? textToOptions(q.optionsText) : [],
      })),
    };
    const res = await fetch(`/api/v1/surveys/${surveyId}/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setSaving(false);
    if (res.ok) {
      setMessage({ kind: "ok", text: "Saved." });
      setDirty(false);
    } else {
      const err = await res.json().catch(() => ({}));
      setMessage({ kind: "err", text: err.error || "Failed to save." });
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-4">
        <Link href="/admin/surveys" className="text-sm text-brand hover:underline mb-4 inline-block">
          &larr; Surveys
        </Link>
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </div>
      </main>
    );
  }

  if (questions === null) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-4">
        <div className="animate-pulse space-y-3">
          <div className="h-6 w-48 bg-gray-100 rounded" />
          <div className="h-40 bg-gray-100 rounded-lg" />
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <Link
        href="/admin/surveys"
        onClick={confirmLeave}
        className="text-sm text-brand hover:underline mb-4 inline-block"
      >
        &larr; Surveys
      </Link>

      {responseCount > 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This survey already has {responseCount} response{responseCount === 1 ? "" : "s"}. Changing an item
          code, type, scale, or reverse-coding — or deleting a question — changes how those existing answers
          are scored and exported. Fix wording typos only; for anything else, create a new survey.
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        <h1 className="text-lg font-semibold text-gray-900">{meta?.title || "Survey"}</h1>
        {meta && (
          <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-600">
            {meta.status}
          </span>
        )}
      </div>
      <div className="mb-5 grid gap-3">
        <label className="text-xs text-gray-500">
          Title
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setMessage(null);
              setDirty(true);
            }}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </label>
        <label className="text-xs text-gray-500">
          Description (optional, shown to participants)
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              setMessage(null);
              setDirty(true);
            }}
            rows={2}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
          />
        </label>
      </div>

      <p className="text-sm text-gray-500 mb-2">
        Each item&apos;s <code className="text-xs">item_code</code> keys the stored answer, and{" "}
        <code className="text-xs">subscale</code> groups items for scoring (e.g. all fatigue items
        share one subscale). Reverse-coded items are flipped automatically at scoring time.
      </p>
      <p className="text-xs text-gray-400 mb-5">
        Replace any placeholder wording with the validated scale items before activating this survey.
      </p>

      <div className="space-y-4">
        {questions.map((q, i) => (
          <div key={i} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-gray-400">Q{i + 1}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move up">
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === questions.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" title="Move down">
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button onClick={() => removeQuestion(i)} className="p-1 text-red-400 hover:text-red-600" title="Remove">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <textarea
              value={q.question_text}
              onChange={(e) => update(i, { question_text: e.target.value })}
              rows={2}
              placeholder="Question text..."
              className="mb-3 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-xs text-gray-500">
                Item code
                <input
                  value={q.item_code}
                  onChange={(e) => update(i, { item_code: e.target.value })}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
              <label className="text-xs text-gray-500">
                Type
                <select
                  value={q.question_type}
                  onChange={(e) => changeType(i, e.target.value)}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                >
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                Subscale
                <input
                  value={q.subscale}
                  onChange={(e) => update(i, { subscale: e.target.value })}
                  placeholder="e.g. privacy_fatigue"
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
            </div>

            {isScale(q.question_type) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-4">
                <label className="text-xs text-gray-500">
                  Min
                  <input
                    type="number"
                    value={q.scale_config.min ?? ""}
                    onChange={(e) => updateScale(i, { min: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Max
                  <input
                    type="number"
                    value={q.scale_config.max ?? ""}
                    onChange={(e) => updateScale(i, { max: e.target.value === "" ? undefined : Number(e.target.value) })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Min label
                  <input
                    value={q.scale_config.min_label ?? ""}
                    onChange={(e) => updateScale(i, { min_label: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Max label
                  <input
                    value={q.scale_config.max_label ?? ""}
                    onChange={(e) => updateScale(i, { max_label: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                  />
                </label>
              </div>
            )}

            {q.question_type === "multiple_choice" && (
              <label className="mt-3 block text-xs text-gray-500">
                Options (one per line; use &ldquo;value | label&rdquo; to store a code different from the text shown)
                <textarea
                  value={q.optionsText}
                  onChange={(e) => update(i, { optionsText: e.target.value })}
                  rows={4}
                  placeholder={"Option A\nOption B\nnobody | Only me"}
                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none"
                />
              </label>
            )}

            <div className="mt-3 flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                Required
              </label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600">
                <input type="checkbox" checked={q.reverse_coded} onChange={(e) => update(i, { reverse_coded: e.target.checked })} />
                Reverse-coded
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={addQuestion}
        className="mt-4 flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50"
      >
        <Plus className="w-4 h-4" />
        Add question
      </button>

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-gray-100 bg-white/90 backdrop-blur py-3">
        <button
          onClick={save}
          disabled={saving}
          className="rounded-md bg-brand px-6 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save survey"}
        </button>
        {message && (
          <span className={`text-sm ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
        {dirty && !message && <span className="text-sm text-amber-600">Unsaved changes</span>}
      </div>
    </main>
  );
}
