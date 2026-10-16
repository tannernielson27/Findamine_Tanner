import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { getCompletion } from "../../_lib/completions";
import { coordinatesForStorage, parseCoordinate } from "@/lib/utils/location-storage";
import { internalError } from "@/lib/utils/internal-error";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // Get user role to check COPPA
    const { data: profile } = await supabase
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    const isChild = profile?.role === "child";

    // Get active session
    const { data: session } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .single();

    if (!session) throw new ApiError(404, "No active play session");

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const findId = formData.get("find_id") as string;
    const caption = formData.get("caption") as string | null;
    // Children's precise location is never stored (COPPA): null for them.
    const coords = coordinatesForStorage(
      profile?.role,
      parseCoordinate(formData.get("latitude")),
      parseCoordinate(formData.get("longitude"))
    );

    if (!findId) throw new ApiError(400, "find_id required");

    // Get completion
    const completion = await getCompletion(supabase, session.id, findId);

    if (!completion) throw new ApiError(404, "Complete the challenge first");

    // COPPA: under-13 photos are local-only
    if (isChild) {
      // Record that capture happened but don't store the image
      const { data: photo, error } = await supabase
        .from("find_photos")
        .insert({
          completion_id: completion.id,
          local_only: true,
          caption: caption || null,
          // No coordinates for a child: the photo and its location stay on the device.
          latitude: null,
          longitude: null,
          uploaded_by: user.id,
        })
        .select()
        .single();

      if (error) throw internalError("/api/v1/play/[huntId]/capture", error);

      return Response.json({
        photo,
        local_only: true,
        message: "Photo saved on your device only (for your privacy).",
      }, { status: 201 });
    }

    // Non-child: upload to Supabase Storage
    let storageRef: string | null = null;

    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        throw new ApiError(400, "Photo too large (max 10MB)");
      }

      const ext = file.name.split(".").pop() || "jpg";
      const path = `${user.id}/${findId}_${Date.now()}.${ext}`;

      // Private bucket (migration 070); only the path is stored.
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("geo-selfies")
        .upload(path, file, { contentType: file.type });

      if (uploadError) throw internalError("/api/v1/play/[huntId]/capture", uploadError);
      storageRef = uploadData.path;
    }

    const { data: photo, error } = await supabase
      .from("find_photos")
      .insert({
        completion_id: completion.id,
        storage_ref: storageRef,
        local_only: false,
        caption: caption || null,
        latitude: coords.latitude,
        longitude: coords.longitude,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (error) throw internalError("/api/v1/play/[huntId]/capture", error);

    return Response.json({ photo, local_only: false }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
