import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getCompletion } from "../../_lib/completions";
import { storeFindPhoto } from "../../_lib/photos";
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
    const file = formData.get("file");
    const findId = formData.get("find_id");
    const caption = formData.get("caption");

    if (typeof findId !== "string" || !findId) throw new ApiError(400, "find_id required");

    // A row also exists after a primer view or clue hint, so check the arrival
    // itself: a photo is only taken at the stop.
    const completion = await getCompletion(supabase, session.id, findId);
    if (!completion?.arrived_at) throw new ApiError(400, "Check in at this stop first");

    const { photo, localOnly } = await storeFindPhoto(supabase, {
      userId: user.id,
      role: user.role,
      completionId: completion.id,
      findId,
      file: file instanceof File ? file : null,
      caption: typeof caption === "string" ? caption : null,
      latitude: parseCoordinate(formData.get("latitude")),
      longitude: parseCoordinate(formData.get("longitude")),
    }, ROUTE);

    if (localOnly) {
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
