import { NextRequest, after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { haversineDistance } from "@/lib/services/hot-cold";
import { coordinatesForStorage, parseCoordinate } from "@/lib/utils/location-storage";
import { checkArrival, MAX_USABLE_ACCURACY_M } from "@/lib/play/arrival-check";
import { landmarkCheckApplies, runLandmarkCheck } from "@/lib/services/landmark-check";
import { getCompletion } from "../../_lib/completions";
import { recordArrival } from "../../_lib/arrival";
import { insertFindPhotoRow, photoFromForm, uploadFindPhoto } from "../../_lib/photos";

const ROUTE = "/api/v1/play/[huntId]/arrive-photo";

interface StopLocation {
  latitude: number;
  longitude: number;
  radius_meters: number | null;
  name: string | null;
  description: string | null;
}

/**
 * Photo check-in: the fallback for "I'm here" when the player's location is
 * off, unavailable or too vague to confirm. The arrival is recorded as not
 * location-checked and flagged for admin review (arrival_review: "pending").
 * The player moves on either way. If the AI landmark check is on and the
 * player opted in, a match clears the flag (see landmark-check.ts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    const isChild = user.role === "child";

    const formData = await request.formData();
    const findId = formData.get("find_id");
    if (typeof findId !== "string" || !findId) throw new ApiError(400, "find_id required");
    // Children's photos stay on the device, so only they check in without one.
    const file = isChild ? null : photoFromForm(formData.get("file"));
    if (!file && !isChild) throw new ApiError(400, "A photo is required");

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
      .select("id, locations(latitude, longitude, radius_meters, name, description)")
      .eq("id", findId)
      .eq("hunt_id", huntId)
      .single();
    if (!find) throw new ApiError(404, "Find not found");
    const loc = find.locations as unknown as StopLocation | null;

    const existing = await getCompletion(supabase, session.id, findId);
    if (existing?.arrived_at) {
      return Response.json({ arrived: true, already_arrived: true, completion_id: existing.id });
    }

    const latitude = parseCoordinate(formData.get("latitude"));
    const longitude = parseCoordinate(formData.get("longitude"));
    const accuracy = parseCoordinate(formData.get("accuracy"));
    const distance =
      latitude !== null && longitude !== null && loc
        ? haversineDistance(latitude, longitude, loc.latitude, loc.longitude)
        : null;
    // A usable fix that puts the player clearly away from the stop can't be
    // overruled by a photo: this route is for when GPS can't tell.
    if (
      distance !== null && loc && accuracy !== null && accuracy <= MAX_USABLE_ACCURACY_M &&
      checkArrival({ distance, accuracy, radius: loc.radius_meters }).kind === "too_far"
    ) {
      throw new ApiError(400, "Your location shows you're not at this stop yet. Get closer, then try again.");
    }

    // Upload before recording anything, so a failed upload leaves no
    // half-made arrival behind and a retry can still attach the photo.
    const storageRef = await uploadFindPhoto(supabase, { userId: user.id, role: user.role, findId, file }, ROUTE);
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

    // The photo row carries completion_id, which is how a reviewer finds it.
    const photo = await insertFindPhotoRow(supabase, {
      userId: user.id,
      role: user.role,
      completionId: recorded.completion.id,
      storageRef,
      caption: null,
      latitude,
      longitude,
    }, ROUTE);

    if (file && !recorded.alreadyArrived && loc?.name && (await landmarkCheckApplies(supabase, user))) {
      after(() =>
        runLandmarkCheck(supabase, {
          photoId: photo.id,
          arrivalCompletionId: recorded.completion.id,
          file,
          stop: { name: loc.name ?? "", description: loc.description },
        }).then(() => undefined)
      );
    }

    return Response.json(
      {
        arrived: true,
        ...(recorded.alreadyArrived ? { already_arrived: true } : {}),
        completion_id: recorded.completion.id,
        local_only: isChild,
        verified: false,
      },
      { status: recorded.created ? 201 : 200 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
