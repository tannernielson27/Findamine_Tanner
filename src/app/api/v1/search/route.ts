import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { errorResponse, ApiError, getAuthUser, sanitizeFilterInput } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";

const BUILDER_ROLES: readonly string[] = ["teacher", "hunt_creator", "admin", "researcher"];

export async function GET(request: NextRequest) {
  try {
    await generalLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q || q.length < 2) throw new ApiError(400, "Query must be at least 2 characters");

    const safeQ = sanitizeFilterInput(q);
    const limit = parseInt(searchParams.get("limit") || "20");
    const supabase = await createSupabaseServiceClient();
    // Place names and addresses are for hunt builders only: to a player they
    // give away where stops are before the stop is started (issue #16).
    const user = await getAuthUser(request);
    const canSearchPlaces = !!user && BUILDER_ROLES.includes(user.role);

    // Search across hunts, tasks, locations, primers using tsvector where available
    const [hunts, tasks, locations] = await Promise.all([
      supabase
        .from("hunts")
        .select("id, title, description, status")
        .is("deleted_at", null)
        .eq("is_public", true)
        .textSearch("search_vector", safeQ, { type: "websearch" })
        .limit(limit),
      supabase
        .from("tasks")
        .select("id, title, subject_domain, challenge_type")
        .is("deleted_at", null)
        .or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
        .limit(limit),
      canSearchPlaces
        ? supabase
            .from("locations")
            .select("id, name, address")
            .is("deleted_at", null)
            .or(`name.ilike.%${safeQ}%,address.ilike.%${safeQ}%`)
            .limit(limit)
        : Promise.resolve({ data: [] }),
    ]);

    return Response.json({
      results: {
        hunts: hunts.data || [],
        tasks: tasks.data || [],
        locations: locations.data || [],
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
