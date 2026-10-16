import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { assertCleanText } from "@/lib/moderation/guard";
import { internalError } from "@/lib/utils/internal-error";

/**
 * Rate and review a hunt (1-5 stars + optional review text).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const rating = Math.max(1, Math.min(5, parseInt(body.rating) || 3));
    const reviewText = typeof body.review_text === "string" ? body.review_text.slice(0, 2000) || null : null;
    assertCleanText(reviewText, { role: user.role, label: "Your review" });

    const supabase = await createSupabaseServiceClient();

    // Verify user has played this hunt. A replayer has several sessions, so
    // ask for at most one row rather than .maybeSingle(), which errors on many.
    const { data: playSessions, error: sessionError } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", id)
      .eq("user_id", user.id)
      .in("status", ["completed", "active"])
      .limit(1);

    if (sessionError) throw internalError("/api/v1/hunts/[id]/rate", sessionError);

    const hasPlayed = (playSessions || []).length > 0;
    if (!hasPlayed && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You must play this hunt before rating it");
    }

    // Upsert: one rating per user per hunt
    const { data, error } = await supabase
      .from("hunt_ratings")
      .upsert({
        hunt_id: id,
        user_id: user.id,
        rating,
        review_text: reviewText,
      }, { onConflict: "hunt_id,user_id" })
      .select()
      .single();

    if (error) throw internalError("/api/v1/hunts/[id]/rate", error);

    return Response.json({ rating: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServiceClient();
    // Review text is user-generated: only signed-in users get it. Anonymous
    // visitors see star ratings and the average only.
    const viewer = await getAuthUser(request);

    const { data: ratings } = await supabase
      .from("hunt_ratings")
      .select("rating, review_text, created_at")
      .eq("hunt_id", id)
      .order("created_at", { ascending: false })
      .limit(50);

    const allRatings = (ratings || []).map((r) => r.rating);
    const avgRating = allRatings.length
      ? Math.round((allRatings.reduce((a, b) => a + b, 0) / allRatings.length) * 10) / 10
      : null;

    return Response.json({
      avg_rating: avgRating,
      total_ratings: allRatings.length,
      ratings: viewer
        ? ratings || []
        : (ratings || []).map(({ rating, created_at }) => ({ rating, created_at })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
