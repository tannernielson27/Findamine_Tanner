"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { m } from "framer-motion";
import { backdrop, dialog } from "@/lib/motion";
import { socialErrorMessage } from "@/lib/social/friends";

export type ReportTargetType = "message" | "kudos" | "user" | "hunt" | "wall_post" | "shoutout" | "review";

export const REPORT_REASONS = [
  { key: "mean_hurtful", label: "Mean or hurtful" },
  { key: "inappropriate", label: "Inappropriate" },
  { key: "spam", label: "Spam" },
  { key: "off_topic", label: "Off-topic" },
  { key: "other", label: "Something else" },
] as const;

export interface ReportOutcome {
  blocked: boolean;
}

interface ReportDialogProps {
  targetType: ReportTargetType;
  targetId: string;
  /** What is being reported, e.g. "this message" or "Ada". */
  subjectLabel: string;
  /** Offer "Also block this player" (needs a known author who isn't the viewer). */
  canBlock?: boolean;
  onClose: () => void;
  onReported: (outcome: ReportOutcome) => void;
}

const OPTION =
  "flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-themed-border bg-surface px-3 text-base text-themed-text transition-colors hover:bg-themed-bg has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand";

/**
 * Report a chat message, kudos, player or hunt for moderator review, with an
 * optional "also block" in the same step.
 */
export default function ReportDialog({
  targetType,
  targetId,
  subjectLabel,
  canBlock = false,
  onClose,
  onReported,
}: ReportDialogProps) {
  const titleId = useId();
  const [reason, setReason] = useState<string>("");
  const [comment, setComment] = useState("");
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    setError("");
    const fallback = "We couldn't send your report. Check your connection and try again.";
    try {
      const res = await fetch("/api/v1/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: reason,
          target_type: targetType,
          target_id: targetId,
          comment: comment.trim() || undefined,
          block: canBlock && alsoBlock,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(socialErrorMessage(res.status, data.error, fallback));
        return;
      }
      onReported({ blocked: !!data.blocked });
    } catch {
      setError(fallback);
    } finally {
      setSending(false);
    }
  };

  return (
    <m.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      className="fixed inset-0 z-[90] flex items-end justify-center bg-gray-900/50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <m.div
        variants={dialog}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-themed-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-1 flex items-center gap-2">
          <Flag aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--color-error)]" />
          <h2 id={titleId} className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text">
            Report {subjectLabel}
          </h2>
        </div>
        <p className="mb-4 text-sm text-themed-muted">
          A moderator reviews every report. The person won&apos;t know you reported them.
        </p>

        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold text-themed-text">What&apos;s wrong?</legend>
          {REPORT_REASONS.map((r, i) => (
            <label key={r.key} className={OPTION}>
              <input
                ref={i === 0 ? firstRef : undefined}
                type="radio"
                name="report-reason"
                value={r.key}
                checked={reason === r.key}
                onChange={() => setReason(r.key)}
                className="h-4 w-4 accent-[var(--color-brand)]"
              />
              {r.label}
            </label>
          ))}
        </fieldset>

        <label className="mt-4 block text-sm font-semibold text-themed-text">
          Anything else? <span className="font-normal text-themed-muted">(optional)</span>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 500))}
            rows={2}
            className="mt-1 block w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base font-normal text-themed-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
        </label>

        {canBlock && (
          <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3 text-base text-themed-text">
            <input
              type="checkbox"
              checked={alsoBlock}
              onChange={(e) => setAlsoBlock(e.target.checked)}
              className="h-4 w-4 accent-[var(--color-brand)]"
            />
            Also block this player
          </label>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-error)]">
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!reason || sending}
            className="inline-flex min-h-11 items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send report"}
          </button>
        </div>
      </m.div>
    </m.div>
  );
}
