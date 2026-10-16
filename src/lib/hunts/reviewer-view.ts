import { jsonStrings } from "@/lib/hunts/text-filter";

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

export interface QueueFindRow {
  sort_order: number;
  clue_text: string | null;
  clue_hints: unknown;
  deleted_at: string | null;
  tasks: One<{ title: string | null; description: string | null; content: unknown; feedback: unknown; challenge_type: string | null }>;
  primers: One<{ title: string | null; content: unknown }>;
  locations: One<{ name: string | null; description: string | null; address: string | null; safety_notes: string | null }>;
}

/**
 * Everything a player of this stop can read, flattened to text for the
 * reviewer. Answer keys inside task content are included on purpose: the
 * reviewer has to see what players are told is right.
 */
export function stopForReviewer(find: QueueFindRow) {
  const task = one(find.tasks);
  const primer = one(find.primers);
  const place = one(find.locations);
  return {
    sort_order: find.sort_order,
    clue_text: find.clue_text,
    hints: jsonStrings(find.clue_hints),
    task: task
      ? {
          title: task.title,
          description: task.description,
          challenge_type: task.challenge_type,
          content: jsonStrings(task.content),
          feedback: jsonStrings(task.feedback),
        }
      : null,
    primer: primer ? { title: primer.title, content: jsonStrings(primer.content) } : null,
    place: place
      ? { name: place.name, description: place.description, address: place.address, safety_notes: place.safety_notes }
      : null,
  };
}
