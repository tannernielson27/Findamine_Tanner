import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import { withViewerSide } from "@/lib/social/friends";

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ?status=all → everything still live between the viewer and others.
const LIVE_STATUSES = ["accepted", "pending"];

/**
 * GET: the viewer's connections. Each row keeps `requester` / `addressee` and
 * adds the viewer-relative `friend` (the other person) and `direction`
 * ("incoming" = they asked the viewer). Defaults to accepted friends;
 * ?status=pending or ?status=all widens it.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "accepted";
    const statuses = status === "all" ? LIVE_STATUSES : [status];

    const supabase = await createSupabaseServiceClient();

    const { data } = await supabase
      .from("friend_connections")
      .select("*, requester:users!requester_id(id, display_name, avatar_url, profile_visibility), addressee:users!addressee_id(id, display_name, avatar_url, profile_visibility)")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .in("status", statuses)
      .order("created_at", { ascending: false });

    const rows = data || [];

    // Enforce profile-field visibility on the embedded "other" user of each row.
    const otherIds = rows.flatMap((r) => {
      const other = (r.requester_id === user.id ? r.addressee : r.requester) as EmbeddedUser | null;
      return other?.id ? [other.id] : [];
    });
    const rels = await getViewerRelationships(user.id, otherIds);

    const applyFilter = (u: EmbeddedUser | null) => {
      if (!u?.id) return u;
      const rel = u.id === user.id ? "self" : rels.get(u.id) ?? "public";
      return { id: u.id, ...filterProfileForViewer(u, rel) };
    };

    const friends = rows.map((r) =>
      withViewerSide(
        {
          ...r,
          requester: applyFilter(r.requester as EmbeddedUser | null),
          addressee: applyFilter(r.addressee as EmbeddedUser | null),
        },
        user.id
      )
    );

    return Response.json({ friends });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await socialLimiter.check(request);
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "friend requests");

    const body = await request.json().catch(() => null);
    const addresseeId: unknown = body?.addressee_id;
    if (typeof addresseeId !== "string" || !UUID_RE.test(addresseeId)) {
      throw new ApiError(400, "addressee_id required");
    }
    if (addresseeId === user.id) throw new ApiError(400, "You can't add yourself as a friend.");

    const supabase = await createSupabaseServiceClient();

    const { data: addressee } = await supabase
      .from("users")
      .select("id, role, deleted_at")
      .eq("id", addresseeId)
      .maybeSingle();
    if (!addressee || addressee.deleted_at) throw new ApiError(404, "That player couldn't be found.");
    // Children can't send friend requests, so they can't be sent them either.
    if (addressee.role === "child") {
      throw new ApiError(403, "Friend requests aren't available for this account.");
    }

    const { data, error } = await supabase
      .from("friend_connections")
      .insert({ requester_id: user.id, addressee_id: addresseeId })
      .select()
      .single();

    if (!error) return Response.json({ connection: data }, { status: 201 });
    if (error.code !== "23505") throw new ApiError(500, error.message);

    // One row per pair (idx_friends_pair): say what the existing one means.
    const { data: sent } = await supabase
      .from("friend_connections")
      .select("id, status")
      .eq("requester_id", user.id)
      .eq("addressee_id", addresseeId)
      .maybeSingle();
    const { data: received } = await supabase
      .from("friend_connections")
      .select("id, status")
      .eq("requester_id", addresseeId)
      .eq("addressee_id", user.id)
      .maybeSingle();

    if (sent?.status === "accepted" || received?.status === "accepted") {
      throw new ApiError(409, "You're already friends.");
    }
    if (received?.status === "pending") {
      throw new ApiError(409, "This player already sent you a request. Accept it instead.");
    }
    if (received?.status === "declined") {
      // The viewer declined earlier and has changed their mind: reopen the same
      // row as their own request. (The other side can't re-ask after a decline.)
      const { data: reopened, error: reopenError } = await supabase
        .from("friend_connections")
        .update({ requester_id: user.id, addressee_id: addresseeId, status: "pending" })
        .eq("id", received.id)
        .select()
        .single();
      if (reopenError) throw new ApiError(500, reopenError.message);
      return Response.json({ connection: reopened }, { status: 201 });
    }
    throw new ApiError(409, "A friend request between you two already exists.");
  } catch (error) {
    return errorResponse(error);
  }
}
