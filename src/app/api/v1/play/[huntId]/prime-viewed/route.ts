import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { assertStopOpen } from "../../_lib/stop-access";
import { startStop } from "../../_lib/stop-start";

/**
 * Older name for the primer's "I'm ready" tap. The play screen now calls
 * ../start-stop, which also returns the stop's details; this stays for pages
 * that were loaded before that change. It starts the stop the same way (once,
 * see _lib/stop-start.ts) and records `prime_viewed_at` on the first tap.
 */
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
    if (typeof find_id !== "string" || !find_id) throw new ApiError(400, "find_id required");

    const supabase = await createSupabaseServiceClient();

    // Get active session
    const { data: session } = await supabase
      .from("play_sessions")
      .select("id, metadata")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!session) throw new ApiError(404, "No active play session");

    // Clue delivery: only the player's current stop (any stop in all-at-once mode).
    await assertStopOpen(supabase, { huntId, userId: user.id, session, findId: find_id, route: "/api/v1/play/[huntId]/prime-viewed" });

    const started = await startStop(supabase, session.id, find_id, { primerRead: true });

    return Response.json(
      { completion_id: started.completion.id, step: "prime" },
      { status: started.alreadyStarted ? 200 : 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
