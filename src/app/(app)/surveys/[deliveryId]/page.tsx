"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ClipboardList, CheckCircle2, AlertCircle, ArrowLeft } from "lucide-react";
import { safeReturnPath, returnLabel } from "../return-path";

type AnswerValue = number | string;

interface Question {
  item_code: string;
  question_text: string;
  question_type: string;
  options: unknown;
  scale_config: Record<string, unknown> | null;
  subscale: string | null;
  sort_order: number;
  required: boolean;
}

interface Survey {
  id: string;
  title: string;
  description: string | null;
}

interface TakeData {
  delivery: { id: string; status: string; expires_at?: string | null };
  survey: Survey | null;
  questions: Question[];
}

/** Only a pending/opened delivery inside its deadline can still be answered. */
function isClosed(delivery: TakeData["delivery"]): boolean {
  if (delivery.status !== "pending" && delivery.status !== "opened") return true;
  return Boolean(delivery.expires_at) && new Date(delivery.expires_at!).getTime() <= Date.now();
}

// In-progress answers survive a refresh: one sessionStorage draft per delivery,
// dropped once the response is submitted (or the survey has closed).
const DRAFT_KEY_PREFIX = "findamine:survey-draft:";

function readDraft(deliveryId: string): Record<string, AnswerValue> {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY_PREFIX + deliveryId) || "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, AnswerValue] => typeof entry[1] === "number" || typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

function writeDraft(deliveryId: string, answers: Record<string, AnswerValue>): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY_PREFIX + deliveryId, JSON.stringify(answers));
  } catch {
    // storage unavailable: answers simply aren't kept across a refresh
  }
}

function clearDraft(deliveryId: string): void {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY_PREFIX + deliveryId);
  } catch {
    // nothing to clear
  }
}

/** Normalize a multiple_choice `options` value into {value,label} pairs. */
function normalizeOptions(options: unknown): { value: string; label: string }[] {
  if (!Array.isArray(options)) return [];
  return options.map((o) => {
    if (o && typeof o === "object" && "value" in o) {
      const obj = o as { value: unknown; label?: unknown };
      return { value: String(obj.value), label: String(obj.label ?? obj.value) };
    }
    return { value: String(o), label: String(o) };
  });
}

function scaleBounds(q: Question): { min: number; max: number } {
  const cfg = q.scale_config || {};
  const min = typeof cfg.min === "number" ? cfg.min : 1;
  const fallbackMax = q.question_type === "likert_7" ? 7 : 5;
  const max = typeof cfg.max === "number" ? cfg.max : fallbackMax;
  return { min, max };
}

export default function TakeSurveyPage() {
  const params = useParams<{ deliveryId: string }>();
  const router = useRouter();
  const deliveryId = params.deliveryId;

  const [data, setData] = useState<TakeData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({});
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [closed, setClosed] = useState(false);
  const openedRef = useRef(false);
  // Where the participant came from (e.g. the privacy page's survey gate).
  const [returnTo] = useState<string | null>(() =>
    typeof window === "undefined"
      ? null
      : safeReturnPath(new URLSearchParams(window.location.search).get("return"))
  );

  useEffect(() => {
    if (!deliveryId) return;
    fetch(`/api/v1/surveys/${deliveryId}/take`)
      .then(async (r) => {
        if (!r.ok) {
          throw new Error(r.status === 404 ? "This survey isn't available." : "Could not load survey.");
        }
        return r.json();
      })
      .then((d: TakeData) => {
        setData(d);
        if (d.delivery.status === "submitted") {
          setSubmitted(true);
          clearDraft(deliveryId);
          return;
        }
        if (isClosed(d.delivery)) {
          setClosed(true);
          clearDraft(deliveryId);
          return;
        }
        // Pick up where a refresh (or an accidental navigation) left off, for
        // the questions this survey still has.
        const codes = new Set(d.questions.map((q) => q.item_code));
        const draft = Object.fromEntries(Object.entries(readDraft(deliveryId)).filter(([code]) => codes.has(code)));
        if (Object.keys(draft).length > 0) setAnswers((prev) => ({ ...draft, ...prev }));
        // Mark opened once (pending → opened). Fire-and-forget; never blocks the UI.
        if (!openedRef.current && d.delivery.status === "pending") {
          openedRef.current = true;
          fetch(`/api/v1/surveys/${deliveryId}/open`, { method: "POST" }).catch(() => {});
        }
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load survey."));
  }, [deliveryId]);

  function setAnswer(itemCode: string, value: AnswerValue) {
    const next = { ...answers, [itemCode]: value };
    setAnswers(next);
    writeDraft(deliveryId, next);
    setMissing((prev) => {
      if (!prev.has(itemCode)) return prev;
      const next = new Set(prev);
      next.delete(itemCode);
      return next;
    });
  }

  function isAnswered(q: Question): boolean {
    const v = answers[q.item_code];
    if (v === undefined || v === null) return false;
    if (typeof v === "string") return v.trim().length > 0;
    return true;
  }

  async function handleSubmit() {
    if (!data) return;
    const unanswered = data.questions.filter((q) => q.required && !isAnswered(q));
    if (unanswered.length > 0) {
      const codes = new Set(unanswered.map((q) => q.item_code));
      setMissing(codes);
      // Scroll to the first unanswered required question.
      const first = document.getElementById(`q-${unanswered[0].item_code}`);
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setSubmitting(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/v1/surveys/${deliveryId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (res.ok || res.status === 409) {
        clearDraft(deliveryId);
        setSubmitted(true);
      } else if (res.status === 410) {
        clearDraft(deliveryId);
        setClosed(true); // expired or closed while the page was open
      } else {
        setLoadError("Something went wrong submitting your answers. Please try again.");
      }
    } catch {
      // Network failure: the answers are still on screen (and in the draft).
      setLoadError("We couldn't reach the server. Your answers are still here. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── States ──────────────────────────────────────────────────────
  if (loadError && !data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <AlertCircle aria-hidden="true" className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-gray-700">{loadError}</p>
        <Link
          href={returnTo ?? "/surveys"}
          className="inline-flex min-h-11 items-center mt-4 text-sm font-medium text-brand hover:underline"
        >
          {returnTo ? returnLabel(returnTo) : "Back to surveys"}
        </Link>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <div className="fm-shimmer space-y-4">
          <div className="h-8 w-48 bg-gray-100 rounded-xl" />
          <div className="h-32 bg-gray-100 rounded-2xl" />
          <div className="h-32 bg-gray-100 rounded-2xl" />
        </div>
      </main>
    );
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <CheckCircle2 aria-hidden="true" className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-gray-900">
          Thank you!
        </h1>
        <p className="text-sm text-gray-500 mt-1">Your response has been recorded.</p>
        <button
          onClick={() => router.push(returnTo ?? "/surveys")}
          className="inline-block min-h-11 mt-5 rounded-xl bg-brand px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition-colors"
        >
          {returnTo ? returnLabel(returnTo) : "Back to surveys"}
        </button>
        {returnTo && (
          <div>
            <Link href="/surveys" className="inline-flex min-h-11 items-center mt-2 text-sm font-medium text-brand hover:underline">
              Back to surveys
            </Link>
          </div>
        )}
      </main>
    );
  }

  if (closed) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10 text-center">
        <AlertCircle aria-hidden="true" className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <h1 className="font-[family-name:var(--font-display)] text-xl font-bold text-gray-900">
          This survey has closed
        </h1>
        <p className="text-sm text-gray-500 mt-1">It can no longer be answered.</p>
        <Link
          href={returnTo ?? "/surveys"}
          className="inline-flex min-h-11 items-center mt-4 text-sm font-medium text-brand hover:underline"
        >
          {returnTo ? returnLabel(returnTo) : "Back to surveys"}
        </Link>
      </main>
    );
  }

  const questions = [...data.questions].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/surveys"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft aria-hidden="true" className="w-4 h-4" />
        Surveys
      </Link>

      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-1 break-words">
        <ClipboardList aria-hidden="true" className="w-6 h-6 shrink-0 text-brand" />
        {data.survey?.title || "Survey"}
      </h1>
      {data.survey?.description && (
        <p className="text-sm text-gray-500 mb-6">{data.survey.description}</p>
      )}

      {questions.length === 0 ? (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-center text-sm text-gray-500">
          This survey has no questions yet. Please check back later.
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, i) => (
            <QuestionCard
              key={q.item_code}
              q={q}
              index={i + 1}
              value={answers[q.item_code]}
              missing={missing.has(q.item_code)}
              onChange={(v) => setAnswer(q.item_code, v)}
            />
          ))}

          {missing.size > 0 && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0" />
              Please answer the highlighted question{missing.size === 1 ? "" : "s"} before submitting.
            </p>
          )}
          {loadError && (
            <p className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle aria-hidden="true" className="w-4 h-4 shrink-0" />
              {loadError}
            </p>
          )}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-xl bg-brand px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark disabled:opacity-50 transition-colors"
          >
            {submitting ? "Submitting..." : "Submit response"}
          </button>
        </div>
      )}
    </main>
  );
}

// ── Question renderer ───────────────────────────────────────────────
function QuestionCard({
  q,
  index,
  value,
  missing,
  onChange,
}: {
  q: Question;
  index: number;
  value: AnswerValue | undefined;
  missing: boolean;
  onChange: (v: AnswerValue) => void;
}) {
  return (
    <div
      id={`q-${q.item_code}`}
      className={`rounded-2xl bg-white border shadow-sm p-5 transition-colors ${
        missing ? "border-red-300 ring-2 ring-red-100" : "border-gray-100"
      }`}
    >
      <p className="text-sm font-medium text-gray-900 mb-3">
        <span className="text-gray-500 mr-1.5">{index}.</span>
        {q.question_text}
        {q.required && <span className="text-red-600 ml-1" aria-hidden>*</span>}
      </p>
      <QuestionInput q={q} value={value} onChange={onChange} />
    </div>
  );
}

function QuestionInput({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: AnswerValue | undefined;
  onChange: (v: AnswerValue) => void;
}) {
  const cfg = q.scale_config || {};

  if (q.question_type === "likert_5" || q.question_type === "likert_7") {
    const { min, max } = scaleBounds(q);
    const points: number[] = [];
    for (let n = min; n <= max; n++) points.push(n);
    const minLabel = typeof cfg.min_label === "string" ? cfg.min_label : "Strongly disagree";
    const maxLabel = typeof cfg.max_label === "string" ? cfg.max_label : "Strongly agree";
    return (
      <div>
        <div
          role="radiogroup"
          aria-label={q.question_text}
          aria-required={q.required}
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
        >
          {points.map((n) => {
            const active = value === n;
            return (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange(n)}
                className={`min-h-11 rounded-lg border py-2.5 text-sm font-medium transition ${
                  active
                    ? "border-brand bg-brand text-white shadow-sm"
                    : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
        <div className="flex justify-between gap-2 text-xs text-gray-500 mt-1.5 px-0.5">
          <span>{minLabel}</span>
          <span className="text-right">{maxLabel}</span>
        </div>
      </div>
    );
  }

  if (q.question_type === "multiple_choice") {
    const opts = normalizeOptions(q.options);
    return (
      <div role="radiogroup" aria-label={q.question_text} aria-required={q.required} className="space-y-2">
        {opts.map((o) => {
          const active = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm break-words transition ${
                active
                  ? "border-brand bg-brand/5 text-gray-900"
                  : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
              }`}
            >
              <span
                className={`grid h-4 w-4 place-items-center rounded-full border shrink-0 ${
                  active ? "border-brand" : "border-gray-300"
                }`}
              >
                {active && <span className="h-2 w-2 rounded-full bg-brand" />}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (q.question_type === "slider") {
    const { min, max } = scaleBounds(q);
    const step = typeof cfg.step === "number" ? cfg.step : 1;
    const current = typeof value === "number" ? value : Math.round((min + max) / 2);
    return (
      <div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={current}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-h-11 w-full accent-brand"
          aria-label={q.question_text}
        />
        <div className="text-center text-sm font-medium text-gray-700 mt-1">{current}</div>
      </div>
    );
  }

  // free_text (and any other type fall back to a text box)
  return (
    <textarea
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      aria-label={q.question_text}
      aria-required={q.required}
      className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-colors"
      placeholder="Type your answer..."
    />
  );
}
