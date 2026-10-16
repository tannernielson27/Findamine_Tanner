import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { blockUser, isMissingTable } from "@/lib/moderation/blocks";
import { assertTrustedOrigin } from "@/lib/utils/origin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BlockedPerson {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

/**
 * GET: the people the viewer has blocked (newest first).
 * GET ?user_id=<id>: { blocked } for one person (the profile page's button).
 *
 * Names are shown as stored: the viewer chose to block this person, so they
 * have already seen who it is. Nothing here reveals who blocked the viewer.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();
    const one = new URL(request.url).searchParams.get("user_id");

    if (one) {
      if (!UUID_RE.test(one)) throw new ApiError(400, "user_id must be a UUID");
      const { data, error } = await supabase
        .from("user_blocks")
        .select("id")
        .eq("blocker_id", user.id)
        .eq("blocked_id", one)
        .maybeSingle();
      if (error && !isMissingTable(error)) throw new ApiError(500, "Couldn't check that block.");
      return Response.json({ blocked: !!data });
    }

    const { data, error } = await supabase
      .from("user_blocks")
      .select("blocked_id, created_at, blocked:users!blocked_id(id, display_name, avatar_url)")
      .eq("blocker_id", user.id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return Response.json({ blocks: [] });
      throw new ApiError(500, "Couldn't load your blocked players.");
    }

    const blocks = (data || []).map((r) => {
      const person = (r.blocked ?? null) as unknown as BlockedPerson | null;
      return {
        user_id: r.blocked_id as string,
        created_at: r.created_at as string,
        display_name: person?.display_name ?? null,
        avatar_url: person?.avatar_url ?? null,
      };
    });
    return Response.json({ blocks });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST { user_id }: block someone. Also removes any friendship or request. */
export async function POST(request: NextRequest) {
  try {
    assertTrustedOrigin(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    const targetId: unknown = body?.user_id;
    if (typeof targetId !== "string" || !UUID_RE.test(targetId)) {
      throw new ApiError(400, "user_id required");
    }
    if (targetId === user.id) throw new ApiError(400, "You can't block yourself.");

    const supabase = await createSupabaseServiceClient();
    const { data: target } = await supabase
      .from("users")
      .select("id, deleted_at")
      .eq("id", targetId)
      .maybeSingle();
    if (!target || target.deleted_at) throw new ApiError(404, "That player couldn't be found.");

    await blockUser(supabase, user.id, targetId);
    return Response.json({ blocked: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
