import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import { assertCleanText } from "@/lib/moderation/guard";
import { assertNotBlocked, getBlockSets, hiddenUserIds, withoutAuthors } from "@/lib/moderation/blocks";
import { areConnected } from "@/lib/social/connections";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/utils/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data } = await supabase
      .from("shoutouts")
      .select("*, sender:users!sender_id(id, display_name, avatar_url, profile_visibility), receiver:users!receiver_id(id, display_name, avatar_url, profile_visibility)")
      .eq("receiver_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    const hidden = hiddenUserIds(await getBlockSets(supabase, user.id));
    // moderation_status arrives with migration 072; filtered here (not in the
    // query) so this keeps working before it is applied.
    const rows = withoutAuthors(data || [], (r) => r.sender_id as string, hidden).filter(
      (r) => r.moderation_status !== "removed"
    );

    // receiver is always the viewer; filter the embedded sender by relationship.
    const senderIds = rows.flatMap((r) => {
      const s = r.sender as EmbeddedUser | null;
      return s?.id ? [s.id] : [];
    });
    const rels = await getViewerRelationships(user.id, senderIds);

    const applyFilter = (u: EmbeddedUser | null) => {
      if (!u?.id) return u;
      const rel = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
      return { id: u.id, ...filterProfileForViewer(u, rel) };
    };

    const shoutouts = rows.map((r) => ({
      ...r,
      sender: applyFilter(r.sender as EmbeddedUser | null),
      receiver: applyFilter(r.receiver as EmbeddedUser | null),
    }));

    return Response.json({ shoutouts });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "shoutouts");
    await socialLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    if (!body?.receiver_id) throw new ApiError(400, "receiver_id required");
    if (!body.message || typeof body.message !== "string") throw new ApiError(400, "message required");
    if (body.message.length > 1000) throw new ApiError(400, "Message must be 1000 characters or fewer");
    if (body.receiver_id === user.id) throw new ApiError(400, "Cannot send a shoutout to yourself");
    if (typeof body.receiver_id !== "string" || !UUID_RE.test(body.receiver_id)) {
      throw new ApiError(404, "That player couldn't be found.");
    }
    assertCleanText(body.message, { role: user.role, label: "That shoutout" });

    const supabase = await createSupabaseServiceClient();
    // Like kudos: only to people you're connected with, never across a block.
    await assertNotBlocked(supabase, user.id, body.receiver_id, "You can't send a shoutout to this player.");
    if (!(await areConnected(supabase, user.id, body.receiver_id))) {
      throw new ApiError(403, "You can send shoutouts to friends, crew, teammates and classmates.");
    }

    const { data, error } = await supabase
      .from("shoutouts")
      .insert({
        sender_id: user.id,
        receiver_id: body.receiver_id,
        message: body.message.slice(0, 1000),
        hunt_id: body.hunt_id || null,
      })
      .select()
      .single();

    if (error) {
      logger.error("shoutout.send_failed", { error: error.message });
      throw new ApiError(500, "Your shoutout didn't send. Please try again.");
    }

    return Response.json({ shoutout: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
