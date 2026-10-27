import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // The session and the hunt's find count are independent reads.
    const [{ data: session }, { count }] = await Promise.all([
      supabase
        .from("play_sessions")
        .select("*, find_completions(*)")
        .eq("hunt_id", huntId)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("finds")
        .select("id", { count: "exact", head: true })
        .eq("hunt_id", huntId)
        .is("deleted_at", null),
    ]);

    if (!session) {
      return Response.json({ session: null, completions: [], total_finds: 0 });
    }

    return Response.json({
      session,
      completions: session.find_completions || [],
      total_finds: count || 0,
      completed_finds: (session.find_completions || []).filter(
        (c: { completed_at: string | null }) => c.completed_at
      ).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
