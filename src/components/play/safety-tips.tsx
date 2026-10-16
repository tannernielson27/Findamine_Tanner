import { Footprints, TriangleAlert } from "lucide-react";
import { SAFETY_REMINDER, SAFETY_TIPS } from "@/lib/play/safety";

/**
 * Presentational safety pieces with no client state, so server pages (the
 * hunt detail page) and the play loop can share them.
 */

/** The full list of play-safely tips. */
export function SafetyTipList({ className = "" }: { className?: string }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {SAFETY_TIPS.map((tip) => (
        <li key={tip.id} className="flex items-start gap-2 text-base text-themed-text">
          <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-secondary" />
          <span>{tip.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** One-line reminder kept on screen while walking to a stop. */
export function SafetyReminder() {
  return (
    <p className="mb-4 inline-flex items-center justify-center gap-1.5 text-sm text-themed-muted">
      <Footprints className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
      {SAFETY_REMINDER}
    </p>
  );
}

/** A creator's stop-specific safety note. Renders nothing when there is none. */
export function StopSafetyNote({ notes }: { notes: string | null | undefined }) {
  const text = typeof notes === "string" ? notes.trim() : "";
  if (!text) return null;
  return (
    <div role="note" className="mb-4 rounded-xl border border-warning/30 bg-warning/10 p-3 text-left">
      <p className="mb-1 inline-flex items-center gap-1.5 text-sm font-semibold text-warning">
        <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        Safety note for this stop
      </p>
      <p className="whitespace-pre-line text-base text-themed-text">{text}</p>
    </div>
  );
}
