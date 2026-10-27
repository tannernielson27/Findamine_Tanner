import { NextRequest } from "next/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) {
      throw new ApiError(401, "Not authenticated");
    }

    // Get full profile
    const supabase = await createSupabaseServiceClient();
    // The profile row and the age band are independent reads.
    const [{ data: profile, error }, { data: bandRow }] = await Promise.all([
      supabase
        .from("users")
        .select("id, email, display_name, avatar_url, role, status, created_at, metadata, profile_visibility, profile_visibility_overrides")
        .eq("id", user.id)
        .is("deleted_at", null)
        .single(),
      // age_band is a user_profiles column (effective_band). Selecting it from
      // `users` failed this whole query in PostgREST, so /auth/me 404'd — which
      // is the call the privacy page depends on for its condition and settings.
      supabase.from("user_profiles").select("effective_band").eq("user_id", user.id).maybeSingle(),
    ]);

    if (error || !profile) {
      throw new ApiError(404, "User profile not found");
    }

    return Response.json({ user: { ...profile, age_band: bandRow?.effective_band ?? null } });
  } catch (error) {
    return errorResponse(error);
  }
}
