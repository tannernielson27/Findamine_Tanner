"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { HttpError, safeFetch } from "@/lib/play/play-api";

const CATEGORIES = [
  { key: "mean_hurtful", label: "Mean / hurtful" },
  { key: "inappropriate", label: "Inappropriate" },
  { key: "spam", label: "Spam" },
  { key: "off_topic", label: "Off-topic" },
  { key: "other", label: "Other" },
];

interface ReportProblemProps {
  /** The stop being reported, or the hunt when there is no stop. */
  targetId: string;
}

/**
 * "Report a problem": accessible inline disclosure (no prompt/alert). Key it
 * on the stop so it starts closed at every stop.
 */
export function ReportProblem({ targetId }: ReportProblemProps) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

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

  return (
    <div className="mt-4 text-center">
      {done ? (
        <p role="status" className="text-sm text-themed-muted">Thanks for reporting. A teacher will review this.</p>
      ) : !open ? (
        <button
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-themed-muted underline underline-offset-2 transition-colors hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          Report a problem
        </button>
      ) : (
        <div className="inline-block rounded-xl border border-themed-border bg-surface p-3 text-left">
          <p className="text-sm font-semibold text-themed-text mb-2" id="report-label">What&apos;s the issue?</p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="report-label">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                disabled={sending}
                onClick={() => void send(c.key)}
                className="inline-flex min-h-11 items-center rounded-full border border-themed-border bg-themed-bg px-3 text-sm text-themed-text transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
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
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-themed-muted transition-colors hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Cancel
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-2 max-w-xs text-sm font-medium text-error">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
