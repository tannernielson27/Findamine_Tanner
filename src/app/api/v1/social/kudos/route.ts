import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { getViewerRelationships } from "@/lib/utils/viewer";
import { assertCleanText } from "@/lib/moderation/guard";
import { assertNotBlocked, getBlockSets, getReportedEntityIds, hiddenUserIds } from "@/lib/moderation/blocks";
import { areConnected } from "@/lib/social/connections";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { internalError } from "@/lib/utils/internal-error";

type EmbeddedUser = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
};

type KudosRow = {
  sender_id: string;
  receiver_id: string;
  sender?: unknown;
  receiver?: unknown;
  [key: string]: unknown;
};

const KUDOS_SELECT =
  "*, sender:users!sender_id(id, display_name, avatar_url, profile_visibility), receiver:users!receiver_id(id, display_name, avatar_url, profile_visibility)";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// kudos.message is CHECKed to 200 characters (migration 003).
const MAX_MESSAGE_LENGTH = 200;

/** Enforce profile-field visibility on the embedded sender/receiver of each row. */
async function presentKudos(rows: KudosRow[], viewerId: string) {
  const otherIds = rows.flatMap((r) => {
    const other = (r.sender_id === viewerId ? r.receiver : r.sender) as EmbeddedUser | null;
    return other?.id ? [other.id] : [];
  });
  const rels = await getViewerRelationships(viewerId, otherIds);

  const applyFilter = (u: EmbeddedUser | null) => {
    if (!u?.id) return u;
    const rel = u.id === viewerId ? "self" : rels.get(u.id) ?? "public";
    return { id: u.id, ...filterProfileForViewer(u, rel) };
  };

  return rows.map((r) => ({
    ...r,
    // Lets the client offer "Report" only on kudos someone else sent.
    direction: r.sender_id === viewerId ? ("sent" as const) : ("received" as const),
    sender: applyFilter((r.sender ?? null) as EmbeddedUser | null),
    receiver: applyFilter((r.receiver ?? null) as EmbeddedUser | null),
  }));
}

// GET ?type=received (default) | sent | all
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "received";

    const supabase = await createSupabaseServiceClient();

    const base = supabase.from("kudos").select(KUDOS_SELECT);
    const scoped =
      type === "all"
        ? base.or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
        : base.eq(type === "sent" ? "sender_id" : "receiver_id", user.id);
    const { data } = await scoped.order("created_at", { ascending: false }).limit(50);

    // Hide kudos to/from anyone blocked either way, and kudos the viewer reported.
    const rows = (data || []) as KudosRow[];
    const hidden = hiddenUserIds(await getBlockSets(supabase, user.id));
    const reported = await getReportedEntityIds(supabase, user.id, "kudos", rows.map((r) => String(r.id)));
    const visible = rows.filter(
      (r) => r.moderation_status !== "removed" && !hidden.has(r.sender_id) && !hidden.has(r.receiver_id) && !reported.has(String(r.id))
    );

    const kudos = await presentKudos(visible, user.id);

    return Response.json({ kudos });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    blockChildren(user, "kudos");
    await socialLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    if (!body?.receiver_id || !body?.message) {
      throw new ApiError(400, "receiver_id and message required");
    }
    if (typeof body.message !== "string" || body.message.length > MAX_MESSAGE_LENGTH) {
      throw new ApiError(400, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer`);
    }
    if (body.receiver_id === user.id) {
      throw new ApiError(400, "Cannot send kudos to yourself");
    }
    if (typeof body.receiver_id !== "string" || !UUID_RE.test(body.receiver_id)) {
      throw new ApiError(404, "That player couldn't be found.");
    }
    assertCleanText(body.message, { role: user.role, label: "That kudos message" });

    const supabase = await createSupabaseServiceClient();

    // Kudos only go to people you're connected with (friends, crew, teammates,
    // classmates), and never across a block.
    await assertNotBlocked(supabase, user.id, body.receiver_id, "You can't send kudos to this player.");
    if (!(await areConnected(supabase, user.id, body.receiver_id))) {
      throw new ApiError(403, "You can send kudos to friends, crew, teammates and classmates.");
    }

    // Return the row with the same sender/receiver embed the list uses, so the
    // client can show it straight away.
    const { data, error } = await supabase
      .from("kudos")
      .insert({
        sender_id: user.id,
        receiver_id: body.receiver_id,
        message_type: body.message_type || "custom",
        message: body.message,
        hunt_id: body.hunt_id || null,
      })
      .select(KUDOS_SELECT)
      .single();

    if (error) {
      // 23503 = receiver (or hunt) doesn't exist; 22P02 = not a UUID.
      if (error.code === "23503" || error.code === "22P02") {
        throw new ApiError(404, "That player couldn't be found.");
      }
      throw internalError("/api/v1/social/kudos", error);
    }

    const [kudos] = await presentKudos([data as KudosRow], user.id);

    return Response.json({ kudos }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
