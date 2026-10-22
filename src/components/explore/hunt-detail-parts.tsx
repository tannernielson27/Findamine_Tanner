/**
 * Small server-safe pieces of the hunt detail page.
 */
import type { ReactNode } from "react";
import {
  Calculator,
  Camera,
  ClipboardList,
  Eye,
  ListChecks,
  ListOrdered,
  MessagesSquare,
  Mic,
  PenLine,
  Pencil,
  type LucideIcon,
} from "lucide-react";

/** tasks.challenge_type → what a player does, in plain words. */
const CHALLENGE_LABELS: Record<string, { label: string; icon: LucideIcon }> = {
  multiple_choice: { label: "Multiple choice", icon: ListChecks },
  numeric_entry: { label: "Number answer", icon: Calculator },
  short_text: { label: "Short answer", icon: PenLine },
  photo_observation: { label: "Photo", icon: Camera },
  sketch_draw: { label: "Sketch", icon: Pencil },
  audio_response: { label: "Spoken answer", icon: Mic },
  sorting_ordering: { label: "Put in order", icon: ListOrdered },
  team_debate: { label: "Team discussion", icon: MessagesSquare },
  data_collection: { label: "Observation", icon: Eye },
  creative_writing: { label: "Creative writing", icon: ClipboardList },
};

/** hunts.subject_domains → tag text. */
const SUBJECT_LABELS: Record<string, string> = {
  science_nature: "Nature",
  math_real_world: "Math",
  geography_maps: "Geography",
  critical_thinking: "Puzzles",
  reading_writing: "Reading",
  history_community: "History",
};

export function subjectLabel(domain: string): string {
  return SUBJECT_LABELS[domain] ?? domain.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function ChallengeChips({ types }: { types: string[] }) {
  const known = types.filter((t) => CHALLENGE_LABELS[t]);
  if (known.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {known.map((type) => {
        const { label, icon: Icon } = CHALLENGE_LABELS[type];
        return (
          <li
            key={type}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-themed-border bg-surface px-3.5 text-[15px] text-themed-text"
          >
            <Icon className="h-4 w-4 text-juniper" aria-hidden="true" />
            {label}
          </li>
        );
      })}
    </ul>
  );
}

/** A titled block in the detail content card. */
export function DetailSection({ id, title, children, note }: { id: string; title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex scroll-mt-6 flex-col gap-2.5">
      <h2 id={id} className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text">
        {title}
      </h2>
      {children}
      {note}
    </section>
  );
}
