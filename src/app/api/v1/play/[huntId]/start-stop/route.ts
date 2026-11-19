import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { playLimiter } from "@/lib/utils/rate-limit";
import { internalError } from "@/lib/utils/internal-error";
import { logger } from "@/lib/utils/logger";
import { assertStopOpen } from "../../_lib/stop-access";
import { startStop } from "../../_lib/stop-start";
import { hasPrimer, startedStopView, STOP_SOURCE_COLUMNS, type StopSource } from "../../_lib/stop-view";

const ROUTE = "/api/v1/play/[huntId]/start-stop";
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * POST /api/v1/play/[huntId]/start-stop  { find_id }
 *   → { completion_id, started_at, already_started, stop }
 *
 * "I'm ready": starts the stop's clock on the server and releases its details
 * (clue, place, challenge) in the same reply. Idempotent: the first call sets
 * find_completions.started_at (201); every later call returns that same time
 * and the details again (200), so a reload or a retry never restarts the clock.
 *
 * Only for the caller's own active session, and only for a stop their clue
 * order allows (404 for a stop outside the hunt, 409 for one not open yet).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await playLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    const findId: unknown = body?.find_id;
    if (typeof findId !== "string" || !findId) throw new ApiError(400, "find_id required");

    const supabase = await createSupabaseServiceClient();

    const { data: session } = await supabase
      .from("play_sessions")
      .select("id, metadata")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (!session) throw new ApiError(404, "No active play session");

    // Clue delivery: only the player's current stop (any stop in all-at-once mode).
    const { navigationHelp } = await assertStopOpen(supabase, { huntId, userId: user.id, session, findId, route: ROUTE });

    const { data: find, error: findError } = await supabase
      .from("finds")
      .select(STOP_SOURCE_COLUMNS)
      .eq("id", findId)
      .eq("hunt_id", huntId)
      .is("deleted_at", null)
      .maybeSingle();
    if (findError) throw internalError(ROUTE, findError);
    if (!find) throw new ApiError(404, "Find not found");
    const source = find as unknown as StopSource;

    const started = await startStop(supabase, session.id, findId, { primerRead: hasPrimer(source) });
    if (!started.alreadyStarted) {
      logger.info("play.stop_started", { userId: user.id, huntId, findId, startedAt: started.startedAt });
    }

    return Response.json(
      {
        completion_id: started.completion.id,
        started_at: started.startedAt,
        already_started: started.alreadyStarted,
        // Medium and Hard hunts: no place name or coordinates before the stop is completed.
        stop: startedStopView(source, started.startedAt, {
          navigationHelp,
          completed: !!started.completion.completed_at,
        }),
      },
      { status: started.alreadyStarted ? 200 : 201, headers: NO_STORE }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
