"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ClipboardList, Copy, Check, ExternalLink } from "lucide-react";
import { useStudySurveys, type StudyWave } from "@/components/study/use-study-surveys";
import { CONTACT_EMAIL } from "@/lib/constants/legal";
import WithdrawControl from "@/components/study/withdraw-control";

/**
 * "Research participation": the participant's Study ID and their Qualtrics surveys
 * (pilot 2026-11). Deliberately separate from /debrief, which describes the
 * study's conditions. Wording stays neutral: nothing here says what the
 * study measures.
 */
export default function StudyPage() {
  const { state, openWave, markDone, reload } = useStudySurveys();

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 mb-4"
      >
        <ArrowLeft aria-hidden="true" className="w-4 h-4" />
        Settings
      </Link>

      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 flex items-center gap-2 mb-4">
        <ClipboardList aria-hidden="true" className="w-6 h-6 shrink-0 text-brand" />
        Research participation
      </h1>

      {state.kind === "loading" && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-sm text-gray-500" role="status">
          Loading…
        </div>
      )}

      {state.kind === "error" && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-sm text-gray-600 space-y-3">
          <p>We couldn’t load your Study ID and surveys. Check your connection and try again.</p>
          <button onClick={reload} className="min-h-11 text-brand font-medium hover:underline">
            Try again
          </button>
        </div>
      )}

      {state.kind === "not_enrolled" && (
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 text-sm text-gray-600">
          You are not taking part in the research study, so there is no Study ID or survey for you.
        </div>
      )}

      {state.kind === "enrolled" && (
        <div className="space-y-4">
          <StudyIdCard code={state.participantCode} />
          <section
            aria-labelledby="surveys-heading"
            className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 space-y-4"
          >
            <h2 id="surveys-heading" className="font-[family-name:var(--font-display)] font-semibold text-gray-900">
              Surveys
            </h2>
            <p className="text-sm text-gray-600">
              Surveys open in your browser. Your Study ID is filled in for you. When you’re done, come back
              and tap “I finished it”.
            </p>
            <ul className="divide-y divide-gray-100">
              {state.waves
                .filter((w) => w.status !== "not_assigned")
                .map((w) => (
                  <WaveRow key={w.wave} wave={w} onOpen={openWave} onDone={markDone} />
                ))}
            </ul>
          </section>
          <section
            aria-labelledby="leave-heading"
            className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 space-y-2"
          >
            <h2 id="leave-heading" className="font-[family-name:var(--font-display)] font-semibold text-gray-900">
              Leaving the study
            </h2>
            <p className="text-sm text-gray-600">You can stop taking part at any time.</p>
            <WithdrawControl />
          </section>
          <p className="text-xs text-gray-500">
            Questions? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-link underline">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      )}
    </main>
  );
}

function StudyIdCard({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Study ID</p>
      <div className="mt-1 flex items-center gap-3">
        <span className="font-mono text-2xl font-bold tracking-wider text-gray-900" aria-label={`Study ID ${code.split("").join(" ")}`}>
          {code}
        </span>
        <button
          onClick={copy}
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 hover:bg-gray-50"
        >
          {copied ? <Check className="w-4 h-4" aria-hidden="true" /> : <Copy className="w-4 h-4" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">If a survey asks for your Study ID, enter this.</p>
    </section>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function WaveRow({
  wave,
  onOpen,
  onDone,
}: {
  wave: StudyWave;
  onOpen: (w: StudyWave) => void;
  onDone: (w: StudyWave) => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function done() {
    setSaving(true);
    setFailed(false);
    const ok = await onDone(wave);
    setSaving(false);
    if (!ok) setFailed(true);
  }

  return (
    <li className="py-4 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-gray-900">{wave.title}</p>
          <p className="text-xs text-gray-500">
            {wave.status === "done" && "Finished. Thank you!"}
            {wave.status === "open" && `About ${wave.minutes} min`}
            {wave.status === "not_yet" && (wave.opens_at ? `Opens ${formatDate(wave.opens_at)}` : "Opens later")}
          </p>
        </div>
        {wave.status === "open" && (
          <button
            onClick={() => onOpen(wave)}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            Start survey
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {/* Shown for every open survey: the app may have reloaded while the
          participant was in the browser. */}
      {wave.status === "open" && (
        <div className="mt-3">
          <button
            onClick={done}
            disabled={saving}
            className="min-h-11 rounded-lg border border-gray-200 px-4 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            {saving ? "Saving…" : "I finished it"}
          </button>
          <p role="status" className="mt-1 text-xs text-red-600">
            {failed ? "That didn’t save. Try again in a moment." : ""}
          </p>
        </div>
      )}
    </li>
  );
}
