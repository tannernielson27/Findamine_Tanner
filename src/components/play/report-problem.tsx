"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { HttpError, safeFetch } from "@/lib/play/play-api";
import { cn } from "@/lib/utils/cn";

const CATEGORIES = [
  { key: "mean_hurtful", label: "Mean / hurtful" },
  { key: "inappropriate", label: "Inappropriate" },
  { key: "spam", label: "Spam" },
  { key: "off_topic", label: "Off-topic" },
  { key: "other", label: "Other" },
];

type Tone = "light" | "dark";

const TONES: Record<Tone, { muted: string; panel: string; chip: string; error: string }> = {
  light: {
    muted: "text-ink",
    panel: "border border-themed-border bg-white text-ink",
    chip: "border border-themed-border bg-themed-bg text-ink hover:bg-white",
    error: "text-[#B42318]",
  },
  dark: {
    muted: "text-[#D6EFE0]",
    panel: "bg-white/10 text-white",
    chip: "border border-white/30 bg-white/10 text-white hover:bg-white/20",
    error: "text-white",
  },
};

interface ReportProblemProps {
  /** The stop being reported, or the hunt when there is no stop. */
  targetId: string;
  /** "dark" on the juniper results screen. */
  tone?: Tone;
}

/**
 * "Report a problem": accessible inline disclosure (no prompt/alert). Key it
 * on the stop so it starts closed at every stop.
 */
export function ReportProblem({ targetId, tone = "light" }: ReportProblemProps) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const t = TONES[tone];

  async function send(category: string) {
    setSending(true);
    setError(null);
    try {
      await safeFetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, target_type: "find", target_id: targetId }),
      });
      setOpen(false);
      setDone(true);
    } catch (err) {
      // Show the server's own reason (rate limit, invalid report, save failure).
      setError(
        err instanceof HttpError ? err.message : "We couldn't send your report. Check your connection and try again."
      );
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return <p role="status" className={cn("text-center text-base", t.muted)}>Thanks for reporting. A teacher will review this.</p>;
  }

  if (!open) {
    return (
      <div className="text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className={cn(
            "inline-flex min-h-12 items-center rounded-xl px-3 text-base underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            t.muted
          )}
        >
          Report a problem
        </button>
      </div>
    );
  }

  return (
    <div className={cn("rounded-2xl p-3 text-left", t.panel)}>
      <p className="mb-2 text-base font-bold" id="report-label">What&apos;s the issue?</p>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby="report-label">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            disabled={sending}
            onClick={() => void send(c.key)}
            className={cn(
              "inline-flex min-h-12 items-center rounded-full px-4 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-wait disabled:opacity-50",
              t.chip
            )}
          >
            {c.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="inline-flex min-h-12 items-center gap-1 rounded-full px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <X className="h-4 w-4" aria-hidden="true" />
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className={cn("mt-2 text-base font-semibold", t.error)}>
          {error}
        </p>
      )}
    </div>
  );
}
