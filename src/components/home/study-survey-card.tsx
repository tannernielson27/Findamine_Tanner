"use client";

import Link from "next/link";
import { ClipboardList, ChevronRight } from "lucide-react";
import { useStudySurveys } from "@/components/study/use-study-surveys";

/**
 * Home card shown only while a study survey (Qualtrics) is open and not yet
 * finished. Links to "Research participation", which has the Study ID and the link.
 * Renders nothing for non-participants or when nothing is open.
 */
export function StudySurveyCard() {
  const { state } = useStudySurveys();
  if (state.kind !== "enrolled") return null;
  const open = state.waves.filter((w) => w.status === "open");
  if (open.length === 0) return null;
  const first = open[0];

  return (
    <Link
      href="/settings/study"
      className="mx-4 mt-3 flex min-h-11 items-center gap-3 rounded-card border border-themed-border bg-surface p-4 hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-light text-brand-dark" aria-hidden="true">
        <ClipboardList className="h-5 w-5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-themed-text">
          {open.length > 1 ? `${open.length} surveys are ready` : `${first.title} is ready`}
        </span>
        <span className="text-sm text-themed-muted">About {first.minutes} min. Tap to start.</span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
    </Link>
  );
}
