import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { safeSearchTerm, userSearchFilter } from "./search";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function positiveInt(raw: string | null, fallback: number): number {
  const n = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const { searchParams } = new URL(request.url);
    const role = searchParams.get("role");
    const q = searchParams.get("q");
    const limit = Math.min(positiveInt(searchParams.get("limit"), DEFAULT_LIMIT), MAX_LIMIT);
    const page = positiveInt(searchParams.get("page"), 1);
    const from = (page - 1) * limit;

    const supabase = await createSupabaseServiceClient();

    let query = supabase
      .from("users")
      .select("id, display_name, email, role, status, avatar_url, created_at", { count: "exact" })
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + limit - 1);

    if (role) query = query.eq("role", role);
    if (q) {
      const term = safeSearchTerm(q);
      if (term) query = query.or(userSearchFilter(term));
    }

    const { data, error, count } = await query;
    if (error) throw new ApiError(500, error.message);

    return Response.json({
      users: data || [],
      total: count ?? (data || []).length,
      page,
      limit,
      // Lets the page hide admin-only controls and guard self-edits.
      viewer: { id: user.id, role: user.role },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
