import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getHotColdZone, haversineDistance } from "@/lib/services/hot-cold";
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
    // `manual: true` is the player's "I'm already here" / "Skip to Challenge"
    // override for when GPS is denied, unavailable or wrong. It records an
    // arrival that is not GPS-verified and flags it in metadata.
    const manual = body.manual === true;
    const hasCoords =
      typeof body.latitude === "number" &&
      typeof body.longitude === "number" &&
      Number.isFinite(body.latitude) &&
      Number.isFinite(body.longitude);
    const latitude: number | null = hasCoords ? body.latitude : null;
    const longitude: number | null = hasCoords ? body.longitude : null;

    if (!find_id) throw new ApiError(400, "find_id is required");

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

    // Get find's location
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
      radius_meters: number;
    } | null;

    // Calculate distance and hot/cold zone
    let distance: number | null = null;
    let hotCold = null;
    let withinRadius = false;

    if (latitude !== null && longitude !== null && loc) {
      distance = haversineDistance(latitude, longitude, loc.latitude, loc.longitude);
      withinRadius = distance <= (loc.radius_meters || 50);

      if (find.hot_cold_enabled !== false) {
        hotCold = getHotColdZone(distance);
      }
    }

    // Not within radius yet (and no manual override): return hot/cold data
    if (!withinRadius && loc && !manual) {
      return Response.json({
        arrived: false,
        distance,
        hot_cold: hotCold,
        hot_cold_enabled: find.hot_cold_enabled !== false,
        radius_needed: loc.radius_meters || 50,
      });
    }

    // Record the arrival
    const arrival = {
      arrival_lat: latitude,
      arrival_lng: longitude,
      arrival_distance: distance,
      arrival_manual: manual && !withinRadius,
    };

    let completion = await getCompletion(supabase, session.id, find_id);
    let created = false;

    if (!completion) {
      const inserted = await insertCompletion(supabase, session.id, find_id, {
        arrived_at: new Date().toISOString(),
        metadata: arrival,
      });
      completion = inserted.row;
      created = inserted.created;
    }

    if (created) {
      return Response.json({
        arrived: true,
        completion_id: completion.id,
        distance,
        hot_cold: hotCold,
      }, { status: 201 });
    }

    if (completion.arrived_at) {
      return Response.json({
        arrived: true,
        already_arrived: true,
        completion_id: completion.id,
        distance,
        hot_cold: hotCold,
      });
    }

    // A row already exists from the primer or a clue hint: stamp the arrival
    const { error: updateError } = await supabase
      .from("find_completions")
      .update({
        arrived_at: new Date().toISOString(),
        metadata: { ...(completion.metadata || {}), ...arrival },
      })
      .eq("id", completion.id);

    if (updateError) throw new ApiError(500, updateError.message);

    return Response.json({
      arrived: true,
      completion_id: completion.id,
      distance,
      hot_cold: hotCold,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
