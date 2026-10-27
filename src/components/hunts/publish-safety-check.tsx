"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { m } from "framer-motion";
import { backdrop, dialog } from "@/lib/motion";

/** What the creator affirms before a hunt goes public. */
export const PUBLISH_SAFETY_AFFIRMATION =
  "Every stop is on public, safe, accessible ground. Players won't need to enter private property, closed areas or traffic to reach it.";

/** Things to double-check, shown above the affirmation. */
export const PUBLISH_SAFETY_CHECKS: readonly string[] = [
  "No stop is on private property, a construction site, rooftop, rail line or roadway.",
  "Each stop can be reached on a sidewalk or path, in daylight.",
  "Stops near busy streets, water or other hazards have a safety note.",
];

interface PublishSafetyCheckProps {
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Pre-publish safety affirmation. Publish stays disabled until the creator
 * ticks the box, so nobody publishes a hunt by accident without seeing it.
 */
export function PublishSafetyCheck({ busy = false, onConfirm, onCancel }: PublishSafetyCheckProps) {
  const [affirmed, setAffirmed] = useState(false);
  const checkboxId = useId();
  const checkboxRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    checkboxRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <m.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-safety-title"
    >
      <m.div variants={dialog} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-brand" />
          <h2 id="publish-safety-title" className="text-lg font-bold text-gray-900">
            Before you submit
          </h2>
        </div>
        <p className="mb-2 text-sm text-gray-600">
          A reviewer checks every hunt before it is listed in Discover, but players will walk to every
          stop, so please check that:
        </p>
        <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-gray-600">
          {PUBLISH_SAFETY_CHECKS.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
        <label htmlFor={checkboxId} className="mb-5 flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <input
            ref={checkboxRef}
            id={checkboxId}
            type="checkbox"
            checked={affirmed}
            onChange={(e) => setAffirmed(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 accent-sky-600"
          />
          <span className="text-sm font-medium text-gray-800">{PUBLISH_SAFETY_AFFIRMATION}</span>
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-md border border-gray-300 px-4 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!affirmed || busy}
            className="min-h-11 rounded-md bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            Submit for review
          </button>
        </div>
      </m.div>
    </m.div>
  );
}
