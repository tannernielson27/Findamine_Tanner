import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { readNavigationHelp, withoutArrivalDistance } from "@/lib/play/navigation-help";
import { internalError } from "@/lib/utils/internal-error";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // The session, the hunt's find count and its settings are independent reads.
    const [{ data: session }, { count }, { data: hunt, error: huntError }] = await Promise.all([
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
      supabase.from("hunts").select("metadata").eq("id", huntId).maybeSingle(),
    ]);

    if (!session) {
      return Response.json({ session: null, completions: [], total_finds: 0 });
    }
    // Without the hunt's difficulty there is no telling what to leave out:
    // fail rather than read a missing hunt as Easy and send everything.
    if (huntError || !hunt) throw internalError("/api/v1/play/[huntId]/progress", huntError);

    // Hard hunts give no distance to a stop, so the player's own rows come
    // back without how far off their check-in was (issue #15).
    const completions = withoutArrivalDistance(
      (session.find_completions || []) as { completed_at: string | null; metadata?: Record<string, unknown> | null }[],
      readNavigationHelp(hunt.metadata as Record<string, unknown> | null)
    );

    return Response.json({
      session: { ...session, find_completions: completions },
      completions,
      total_finds: count || 0,
      completed_finds: completions.filter(
        (c: { completed_at: string | null }) => c.completed_at
      ).length,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
