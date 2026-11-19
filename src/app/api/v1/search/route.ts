import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { errorResponse, ApiError, getAuthUser, sanitizeFilterInput } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { readsAllContent } from "@/lib/hunts/content-access";

const BUILDER_ROLES: readonly string[] = ["teacher", "hunt_creator", "admin", "researcher"];
const MAX_SEARCH_LIMIT = 50;

function searchPlaces(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  safeQ: string,
  limit: number,
  everyPlace: boolean
) {
  const query = supabase
    .from("locations")
    .select("id, name, address")
    .is("deleted_at", null)
    .or(`name.ilike.%${safeQ}%,address.ilike.%${safeQ}%`)
    .limit(limit);
  return everyPlace ? query : query.eq("is_library", true);
}

export async function GET(request: NextRequest) {
  try {
    await generalLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q");
    if (!q || q.length < 2) throw new ApiError(400, "Query must be at least 2 characters");

    const safeQ = sanitizeFilterInput(q);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20") || 20, 1), MAX_SEARCH_LIMIT);
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
      // Library challenges only: a hunt's own challenge often names its
      // place, and searching its text would say which words it contains.
      supabase
        .from("tasks")
        .select("id, title, subject_domain, challenge_type")
        .is("deleted_at", null)
        .eq("is_library", true)
        .or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%`)
        .limit(limit),
      // Library places for builders (admins and researchers: every place).
      // A builder's own places are in the builder, not in search.
      canSearchPlaces
        ? searchPlaces(supabase, safeQ, limit, readsAllContent(user?.role))
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
