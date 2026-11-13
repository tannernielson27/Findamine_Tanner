import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { haversineDistance } from "@/lib/services/hot-cold";
import { coordinatesForStorage, parseCoordinate } from "@/lib/utils/location-storage";
import { getCompletion } from "../../_lib/completions";
import { recordArrival } from "../../_lib/arrival";
import { storeFindPhoto } from "../../_lib/photos";

const ROUTE = "/api/v1/play/[huntId]/arrive-photo";

/**
 * Photo check-in: the fallback for "I'm here" when the player's location is
 * off, unavailable or too vague to confirm. The photo is saved like a stop
 * selfie, and the arrival is recorded as not location-checked and flagged for
 * admin review (arrival_review: "pending"). The player moves on either way.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const formData = await request.formData();
    const findId = formData.get("find_id");
    const file = formData.get("file");
    if (typeof findId !== "string" || !findId) throw new ApiError(400, "find_id required");
    // Children's photos stay on the device, so only they may check in without one.
    if (!(file instanceof File) && user.role !== "child") throw new ApiError(400, "A photo is required");

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
      .select("id, locations(latitude, longitude)")
      .eq("id", findId)
      .eq("hunt_id", huntId)
      .single();
    if (!find) throw new ApiError(404, "Find not found");

    const existing = await getCompletion(supabase, session.id, findId);
    if (existing?.arrived_at) {
      return Response.json({ arrived: true, already_arrived: true, completion_id: existing.id });
    }

    // A vague fix may still come along; keep its distance for the reviewer.
    const latitude = parseCoordinate(formData.get("latitude"));
    const longitude = parseCoordinate(formData.get("longitude"));
    const accuracy = parseCoordinate(formData.get("accuracy"));
    const loc = find.locations as unknown as { latitude: number; longitude: number } | null;
    const distance =
      latitude !== null && longitude !== null && loc
        ? haversineDistance(latitude, longitude, loc.latitude, loc.longitude)
        : null;
    const stored = coordinatesForStorage(user.role, latitude, longitude);

    const recorded = await recordArrival(supabase, session.id, findId, {
      arrival_lat: stored.latitude,
      arrival_lng: stored.longitude,
      arrival_distance: distance,
      arrival_accuracy: accuracy,
      arrival_method: "photo",
      arrival_manual: true,
      arrival_review: "pending",
    }, ROUTE);

    const { photo, localOnly } = await storeFindPhoto(supabase, {
      userId: user.id,
      role: user.role,
      completionId: recorded.completion.id,
      findId,
      file: file instanceof File ? file : null,
      caption: null,
      latitude,
      longitude,
    }, ROUTE);

    // Link the photo to the arrival so a reviewer can find it.
    const { error } = await supabase
      .from("find_completions")
      .update({ metadata: { ...(recorded.completion.metadata || {}), arrival_photo_id: photo.id } })
      .eq("id", recorded.completion.id);
    if (error) throw new ApiError(500, "Something went wrong. Please try again.");

    return Response.json(
      { arrived: true, completion_id: recorded.completion.id, local_only: localOnly, verified: false },
      { status: recorded.created ? 201 : 200 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
