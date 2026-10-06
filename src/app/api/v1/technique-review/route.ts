import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";

/** Postgres foreign_key_violation: the hunt or completion being reviewed doesn't exist. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Postgres invalid_text_representation: an id that isn't a UUID. */
const INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * Post-challenge technique review.
 * Students reflect on what strategies they used after each challenge.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "Invalid request body");
    const { find_completion_id, hunt_id, strategies, confidence, reflection } = body;

    const validStrategies = [
      "read_carefully", "looked_at_image", "used_hint", "talked_with_team",
      "tried_and_learned", "remembered", "guessed", "not_sure",
    ];

    const filteredStrategies = Array.isArray(strategies)
      ? strategies.filter((s: string) => validStrategies.includes(s)).slice(0, 8)
      : [];

    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase.from("technique_reviews").insert({
      user_id: user.id,
      find_completion_id: find_completion_id || null,
      hunt_id: hunt_id || null,
      strategies: filteredStrategies,
      confidence: Math.max(1, Math.min(3, parseInt(confidence) || 2)),
      reflection: typeof reflection === "string" ? reflection.slice(0, 1000) || null : null,
    });

    if (error) {
      if (error.code === FOREIGN_KEY_VIOLATION || error.code === INVALID_TEXT_REPRESENTATION) {
        throw new ApiError(400, "That challenge could not be found");
      }
      logger.error("technique_review.insert_failed", { userId: user.id, error: error.message });
      throw new ApiError(500, "Could not save your reflection. Please try again.");
    }

    return Response.json({ saved: true });
  } catch (error) {
    return errorResponse(error);
  }
}
