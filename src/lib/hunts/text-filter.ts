import { checkText as checkWithFilter } from "@/lib/moderation/content-filter";

/**
 * Hunt-content adapter over the shared objectionable-content filter
 * (src/lib/moderation/content-filter.ts). Hunt text is screened at the
 * "standard" level at submit/edit time so obvious problems never reach a
 * reviewer or a player; it is not a substitute for publish review.
 */

export interface TextFilterResult {
  /** True when the text contains blocked language. */
  flagged: boolean;
  /** Filter category, for logs and reviewer context (never the matched word). */
  category?: string;
}

export function checkText(text: string | null | undefined): TextFilterResult {
  if (!text) return { flagged: false };
  const result = checkWithFilter(text, "standard");
  return result.allowed ? { flagged: false } : { flagged: true, category: result.category };
}

export interface LabelledText {
  /** Where the text came from, e.g. "the title" or "stop 3's clue". Shown to the author. */
  label: string;
  text: string | null | undefined;
}

/** The label of the first field that contains blocked language, or null when all are clean. */
export function firstFlagged(fields: LabelledText[]): string | null {
  for (const field of fields) {
    if (checkText(field.text).flagged) return field.label;
  }
  return null;
}

/** Every string inside a JSON value (task/primer `content`, hint lists), flattened. */
export function jsonStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(jsonStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(jsonStrings);
  return [];
}
