/**
 * Input validation and sanitization for AI endpoints.
 * Prevents prompt injection, DoS via large payloads, and invalid enum values.
 */

import { GRADE_BANDS } from "./grade-bands";

export const VALID_SUBJECTS = [
  "science_nature", "math_real_world", "geography_maps",
  "critical_thinking", "reading_writing", "history_community",
] as const;

export const VALID_GRADE_BANDS = GRADE_BANDS.map((b) => b.value);

export const VALID_DIFFICULTY_TIERS = ["easy", "medium", "hard"] as const;

export const VALID_DIFFICULTY_PROGRESSIONS = [
  "ascending", "descending", "mixed", "plateau",
] as const;

export const VALID_LOCATION_TYPES = [
  "any", "park", "water", "mountain", "urban", "farm",
  "forest", "campus", "historic", "trail", "field",
] as const;

export const VALID_CHALLENGE_TYPES = [
  "multiple_choice", "numeric_entry", "short_text", "photo_observation",
  "sketch_draw", "audio_response", "sorting_ordering", "team_debate",
  "data_collection", "creative_writing",
] as const;

/**
 * Sanitize a string for use in AI prompts.
 * Removes newlines (prevent prompt injection), template chars, and truncates.
 */
export function sanitizeForPrompt(input: unknown, maxLength = 500): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\n/g, " ")
    .replace(/[{}[\]]/g, "")
    .replace(/--/g, "- ")
    .replace(/`/g, "'")
    .replace(/#{1,6}\s/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .slice(0, maxLength)
    .trim();
}

/**
 * Validate and constrain a JSON object payload size.
 */
export function validatePayloadSize(
  obj: unknown,
  maxChars: number,
  fieldName: string
): void {
  const str = JSON.stringify(obj || {});
  if (str.length > maxChars) {
    throw new Error(`${fieldName} too large (max ${maxChars} characters)`);
  }
}

/**
 * Validate an enum value against a list of valid options.
 */
export function validateEnum<T extends string>(
  value: unknown,
  validValues: readonly T[],
  fieldName: string,
  defaultValue: T
): T {
  if (typeof value !== "string") return defaultValue;
  return validValues.includes(value as T) ? (value as T) : defaultValue;
}

/**
 * Clamp a number within bounds.
 */
export function clampInt(value: unknown, min: number, max: number, defaultVal: number): number {
  const num = parseInt(String(value));
  if (isNaN(num)) return defaultVal;
  return Math.max(min, Math.min(max, num));
}
