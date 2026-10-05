import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getCompletion, insertCompletion } from "../../_lib/completions";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json();
    const { find_id } = body;
    if (!find_id) throw new ApiError(400, "find_id required");

    const supabase = await createSupabaseServiceClient();

    // Get active session
    const { data: session } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!session) throw new ApiError(404, "No active play session");

    // Get or create completion record
    const existing = await getCompletion(supabase, session.id, find_id);

    if (existing) {
      // Update with prime viewed timestamp
      const metadata = (existing.metadata || {}) as Record<string, unknown>;
      await supabase
        .from("find_completions")
        .update({
          metadata: { ...metadata, prime_viewed_at: new Date().toISOString() },
        })
        .eq("id", existing.id);

      return Response.json({ completion_id: existing.id, step: "prime" });
    }

    // Create new completion
    const { row: completion } = await insertCompletion(supabase, session.id, find_id, {
      metadata: { prime_viewed_at: new Date().toISOString() },
    });

    return Response.json({ completion_id: completion.id, step: "prime" }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
