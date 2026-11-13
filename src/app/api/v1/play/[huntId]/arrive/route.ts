import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getHotColdZone, haversineDistance } from "@/lib/services/hot-cold";
import { coordinatesForStorage } from "@/lib/utils/location-storage";
import { checkArrival, stopRadius, type ArrivalVerdict } from "@/lib/play/arrival-check";
import { recordArrival } from "../../_lib/arrival";

const ROUTE = "/api/v1/play/[huntId]/arrive";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Records a player's arrival at a stop, but only when their position is inside
 * the stop's radius (allowing for GPS error, see arrival-check.ts).
 *
 * Two callers:
 *   - GPS pings while navigating (no `manual`): out of range → hot/cold data.
 *   - "I'm here" (`manual: true`): same check, on a fresh fix. When the player
 *     has no usable GPS the reply offers a photo check-in instead
 *     (`photo_allowed`, see ../arrive-photo). Tapping never skips the check.
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
    const manual = body.manual === true;
    const latitude = finiteNumber(body.latitude);
    const longitude = finiteNumber(body.longitude);
    const hasCoords = latitude !== null && longitude !== null;
    const accuracy = finiteNumber(body.accuracy);

    if (!find_id) throw new ApiError(400, "find_id is required");

    const supabase = await createSupabaseServiceClient();

    const { data: session } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!session) throw new ApiError(404, "No active play session");

    const { data: find } = await supabase
      .from("finds")
      .select("hot_cold_enabled, locations(latitude, longitude, radius_meters)")
      .eq("id", find_id)
      .eq("hunt_id", huntId)
      .single();

    if (!find) throw new ApiError(404, "Find not found");

    const loc = find.locations as unknown as {
      latitude: number;
      longitude: number;
      radius_meters: number | null;
    } | null;
    // A stop with no location can't be checked: any arrival counts.
    if (!loc) {
      return arrivedResponse(await record(supabase, session.id, find_id, user.role, {
        latitude, longitude, accuracy, distance: null, manual,
      }), null, null);
    }

    const hotColdEnabled = find.hot_cold_enabled !== false;
    const radius = stopRadius(loc.radius_meters);

    if (!hasCoords) {
      return Response.json({
        arrived: false,
        reason: "no_gps",
        photo_allowed: manual,
        distance: null,
        hot_cold: null,
        hot_cold_enabled: hotColdEnabled,
        radius_needed: radius,
      });
    }

    const distance = haversineDistance(latitude, longitude, loc.latitude, loc.longitude);
    const hotCold = hotColdEnabled ? getHotColdZone(distance) : null;
    const verdict: ArrivalVerdict = checkArrival({ distance, accuracy, radius });

    if (verdict.kind !== "inside") {
      return Response.json({
        arrived: false,
        reason: verdict.kind,
        // Too far is the player's to fix by walking; weak GPS gets the photo route.
        photo_allowed: manual && verdict.kind === "weak_gps",
        distance,
        accuracy,
        hot_cold: hotCold,
        hot_cold_enabled: hotColdEnabled,
        radius_needed: radius,
      });
    }

    const recorded = await record(supabase, session.id, find_id, user.role, {
      latitude, longitude, accuracy, distance, manual,
    });
    return arrivedResponse(recorded, distance, hotCold);
  } catch (error) {
    return errorResponse(error);
  }
}

interface FixDetails {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  distance: number | null;
  manual: boolean;
}

function record(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  sessionId: string,
  findId: string,
  role: string | null | undefined,
  fix: FixDetails
) {
  // For a child only the fact of arrival and the distance are kept: their
  // coordinates are used for the radius check above, never stored.
  const stored = coordinatesForStorage(role, fix.latitude, fix.longitude);
  return recordArrival(supabase, sessionId, findId, {
    arrival_lat: stored.latitude,
    arrival_lng: stored.longitude,
    arrival_distance: fix.distance,
    arrival_accuracy: fix.accuracy,
    arrival_method: fix.manual ? "gps_tap" : "gps",
    arrival_manual: false,
  }, ROUTE);
}

function arrivedResponse(
  recorded: Awaited<ReturnType<typeof recordArrival>>,
  distance: number | null,
  hotCold: ReturnType<typeof getHotColdZone> | null
) {
  return Response.json(
    {
      arrived: true,
      ...(recorded.alreadyArrived ? { already_arrived: true } : {}),
      completion_id: recorded.completion.id,
      distance,
      hot_cold: hotCold,
    },
    { status: recorded.created ? 201 : 200 }
  );
}
