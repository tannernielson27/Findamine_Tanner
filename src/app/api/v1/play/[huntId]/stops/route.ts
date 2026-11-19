import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { loadSessionStops } from "../../_lib/stop-access";
import { stopStartedAt } from "../../_lib/stop-start";
import { lockedStopView, startedStopView, STOP_SOURCE_COLUMNS, type StopSource } from "../../_lib/stop-view";
import type { HuntPhase, HuntWindow } from "@/lib/hunts/schedule";
import type { PlaySchedule } from "@/lib/play/play-types";

const ROUTE = "/api/v1/play/[huntId]/stops";

/** The time a stop opens, when that is still to come; null once it is out. */
function unreleasedAt(releaseAtMs: number | null, nowMs: number): string | null {
  return releaseAtMs !== null && nowMs < releaseAtMs ? new Date(releaseAtMs).toISOString() : null;
}

/** The hunt's window for the play screen; null on a play-anytime hunt. */
function scheduleView(
  window: HuntWindow | null,
  phase: HuntPhase,
  nowMs: number,
  releases: ReadonlyArray<number | null>
): PlaySchedule | null {
  if (!window || phase === "anytime") return null;
  const upcoming = releases.filter((ms): ms is number => ms !== null && ms > nowMs && ms < window.endsAtMs);
  return {
    starts_at: new Date(window.startsAtMs).toISOString(),
    ends_at: new Date(window.endsAtMs).toISOString(),
    phase,
    next_release_at: upcoming.length > 0 ? new Date(Math.min(...upcoming)).toISOString() : null,
    server_time: new Date(nowMs).toISOString(),
  };
}
const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/v1/play/[huntId]/stops → { stops: Find[] }
 *
 * The stops of the caller's active session, in the order that session plays
 * them. A stop's clue, place and challenge are included only once the player
 * has started it (POST ../start-stop); before that the stop is a neutral
 * placeholder, with its primer if the clue order has reached it (issue #16).
 *
 * On a scheduled hunt (issue #14) `schedule` is the hunt's window and the
 * next release, and a stop that has not been released is a placeholder with
 * the time it opens (`release_at`) and nothing else.
 *
 * `navigation_help` is the hunt's level (issue #15). On Medium and Hard hunts
 * a started stop comes without its place name and coordinates until the
 * player has completed it, and without its challenge until they have arrived
 * (see _lib/stop-view.ts).
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

    const { ordered, progress, isOpen, navigationHelp, window, phase, nowMs, releaseMs } = await loadSessionStops<StopSource>(
      supabase,
      { huntId, userId: user.id, session, route: ROUTE },
      STOP_SOURCE_COLUMNS
    );

    const stops = ordered.map((find) => {
      const row = progress.get(find.id);
      const startedAt = stopStartedAt(row);
      return startedAt
        ? startedStopView(find, startedAt, { navigationHelp, arrived: !!row?.arrived_at, completed: !!row?.completed_at })
        : lockedStopView(find, isOpen(find.id), unreleasedAt(releaseMs(find.id), nowMs));
    });

    return Response.json(
      { stops, navigation_help: navigationHelp, schedule: scheduleView(window, phase, nowMs, ordered.map((f) => releaseMs(f.id))) },
      { headers: NO_STORE }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
