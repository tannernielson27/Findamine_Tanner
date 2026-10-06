import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";

/** Postgres foreign_key_violation: the hint or stop being rated doesn't exist. */
const FOREIGN_KEY_VIOLATION = "23503";
/** Postgres invalid_text_representation: an id that isn't a UUID. */
const INVALID_TEXT_REPRESENTATION = "22P02";

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") throw new ApiError(400, "Invalid request body");
    const { hint_cache_id, find_id, rating, comment } = body;

    if (!rating || ![-1, 1].includes(rating)) {
      throw new ApiError(400, "Rating must be -1 (thumbs down) or 1 (thumbs up)");
    }

    const supabase = await createSupabaseServiceClient();

    const { error } = await supabase.from("hint_ratings").insert({
      user_id: user.id,
      hint_cache_id: hint_cache_id || null,
      find_id: find_id || null,
      rating,
      comment: typeof comment === "string" ? comment.slice(0, 500) || null : null,
    });

    if (error) {
      if (error.code === FOREIGN_KEY_VIOLATION || error.code === INVALID_TEXT_REPRESENTATION) {
        throw new ApiError(400, "That hint could not be found");
      }
      logger.error("hints.rate.insert_failed", { userId: user.id, error: error.message });
      throw new ApiError(500, "Could not save your rating. Please try again.");
    }

    return Response.json({ rated: true });
  } catch (error) {
    return errorResponse(error);
  }
}
