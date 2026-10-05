import { ApiError } from "@/lib/utils/api-auth";

const SCAFFOLDING_LEVELS = ["high", "medium", "low"];
const MAX_CLUE_HINTS = 5;

/**
 * Validate the creator-editable columns of a find (stop) from a request body.
 * Returns only the fields that were actually sent, so it serves both POST
 * (caller supplies defaults) and PUT (partial update).
 */
export function parseFindFields(body: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const key of ["location_id", "task_id", "primer_id"]) {
    if (body[key] !== undefined) fields[key] = body[key] || null;
  }

  if (body.sort_order !== undefined) {
    const order = Number(body.sort_order);
    if (!Number.isInteger(order) || order < 0) {
      throw new ApiError(400, "sort_order must be a non-negative whole number");
    }
    fields.sort_order = order;
  }

  if (body.clue_text !== undefined) fields.clue_text = body.clue_text || null;
  if (body.hot_cold_enabled !== undefined) fields.hot_cold_enabled = !!body.hot_cold_enabled;
  if (body.metadata !== undefined) fields.metadata = body.metadata || {};

  if (body.scaffolding_level !== undefined) {
    if (!SCAFFOLDING_LEVELS.includes(body.scaffolding_level as string)) {
      throw new ApiError(400, "scaffolding_level must be high, medium, or low");
    }
    fields.scaffolding_level = body.scaffolding_level;
  }

  if (body.clue_hints !== undefined) {
    if (!Array.isArray(body.clue_hints)) {
      throw new ApiError(400, "clue_hints must be a list of text hints");
    }
    fields.clue_hints = body.clue_hints
      .filter((h): h is string => typeof h === "string" && h.trim() !== "")
      .slice(0, MAX_CLUE_HINTS);
  }

  return fields;
}
