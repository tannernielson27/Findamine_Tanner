import { NextRequest, after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getCompletion } from "../../_lib/completions";
import { insertFindPhotoRow, photoFromForm, uploadFindPhoto } from "../../_lib/photos";
import { landmarkCheckApplies, runLandmarkCheck } from "@/lib/services/landmark-check";
import { parseCoordinate } from "@/lib/utils/location-storage";

const ROUTE = "/api/v1/play/[huntId]/capture";

/** The optional photo after a stop's challenge (the "geo-selfie"). */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data: session } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!session) throw new ApiError(404, "No active play session");

    const formData = await request.formData();
    // A child's photo is never uploaded (COPPA), so it isn't even read.
    const file = user.role === "child" ? null : photoFromForm(formData.get("file"));
    const findId = formData.get("find_id");
    const caption = formData.get("caption");

    if (typeof findId !== "string" || !findId) throw new ApiError(400, "find_id required");

    // A row also exists after a primer view or clue hint, so check the arrival
    // itself: a photo is only taken at the stop.
    const completion = await getCompletion(supabase, session.id, findId);
    if (!completion?.arrived_at) throw new ApiError(400, "Check in at this stop first");

    const storageRef = await uploadFindPhoto(supabase, { userId: user.id, role: user.role, findId, file }, ROUTE);
    const photo = await insertFindPhotoRow(supabase, {
      userId: user.id,
      role: user.role,
      completionId: completion.id,
      storageRef,
      caption: typeof caption === "string" ? caption : null,
      latitude: parseCoordinate(formData.get("latitude")),
      longitude: parseCoordinate(formData.get("longitude")),
    }, ROUTE);

    if (file && (await landmarkCheckApplies(supabase, user))) {
      const stop = await stopText(supabase, huntId, findId);
      if (stop) after(() => runLandmarkCheck(supabase, { photoId: photo.id, file, stop }).then(() => undefined));
    }

    if (user.role === "child") {
      return Response.json({
        photo,
        local_only: true,
        message: "Photo saved on your device only (for your privacy).",
      }, { status: 201 });
    }
    return Response.json({ photo, local_only: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;

async function stopText(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  huntId: string,
  findId: string
): Promise<{ name: string; description: string | null } | null> {
  const { data } = await supabase
    .from("finds")
    .select("locations(name, description)")
    .eq("id", findId)
    .eq("hunt_id", huntId)
    .single();
  const loc = data?.locations as unknown as { name: string | null; description: string | null } | null;
  return loc?.name ? { name: loc.name, description: loc.description } : null;
}
