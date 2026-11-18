import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { loadSessionStops } from "../../_lib/stop-access";
import { stopStartedAt } from "../../_lib/stop-start";
import { lockedStopView, startedStopView, STOP_SOURCE_COLUMNS, type StopSource } from "../../_lib/stop-view";

const ROUTE = "/api/v1/play/[huntId]/stops";
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/v1/play/[huntId]/stops → { stops: Find[] }
 *
 * The stops of the caller's active session, in the order that session plays
 * them. A stop's clue, place and challenge are included only once the player
 * has started it (POST ../start-stop); before that the stop is a neutral
 * placeholder, with its primer if the clue order has reached it (issue #16).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // Only the caller's own active session: the lookup is by their user id.
    const { data: session } = await supabase
      .from("play_sessions")
      .select("id, metadata")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!session) throw new ApiError(404, "No active play session");

    const { ordered, progress, isOpen } = await loadSessionStops<StopSource>(
      supabase,
      { huntId, userId: user.id, session, route: ROUTE },
      STOP_SOURCE_COLUMNS
    );

    const stops = ordered.map((find) => {
      const startedAt = stopStartedAt(progress.get(find.id));
      return startedAt ? startedStopView(find, startedAt) : lockedStopView(find, isOpen(find.id));
    });

    return Response.json({ stops }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
