import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { socialLimiter } from "@/lib/utils/rate-limit";
import { filterProfileForViewer } from "@/lib/utils/privacy";
import { isActiveMember } from "../../team-rules";
import { assertCleanText } from "@/lib/moderation/guard";
import { getBlockSets, getReportedEntityIds, hiddenUserIds, withoutAuthors } from "@/lib/moderation/blocks";
import { logger } from "@/lib/utils/logger";

interface ChatSender {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  profile_visibility?: Record<string, string>;
}

/**
 * Chat access is team-gated, so every viewer's relationship to a sender is
 * "team" (or "self"). A member who restricts display_name/avatar beyond team
 * stays hidden even inside the chat.
 */
function filterSender(sender: ChatSender | null, viewerId: string) {
  if (!sender?.id) return sender;
  const rel = sender.id === viewerId ? ("self" as const) : ("team" as const);
  return { id: sender.id, ...filterProfileForViewer(sender, rel) };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // Verify user is a CURRENT member of this team. (Without the status filter
    // a player who left could keep reading, and one who left and rejoined had
    // two rows, which made maybeSingle() fail and locked them out.)
    if (!["admin", "researcher"].includes(user.role)) {
      if (!(await isActiveMember(supabase, id, user.id))) {
        throw new ApiError(403, "Not a member of this team");
      }
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50") || 50, 200);

    const { data, error } = await supabase
      .from("team_messages")
      .select("*, users(id, display_name, avatar_url, profile_visibility)")
      .eq("team_id", id)
      .neq("moderation_status", "removed")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      logger.error("team_chat.load_failed", { teamId: id, error: error.message });
      throw new ApiError(500, "Couldn't load the chat. Please try again.");
    }

    // Per-viewer hiding: messages from anyone the viewer blocked (or who
    // blocked them), and messages the viewer has reported.
    const rows = data || [];
    const blocks = await getBlockSets(supabase, user.id);
    const hidden = hiddenUserIds(blocks);
    const reported = await getReportedEntityIds(supabase, user.id, "message", rows.map((m) => m.id as string));
    const visible = withoutAuthors(rows, (m) => m.user_id as string, hidden).filter((m) => !reported.has(m.id as string));

    const messages = visible
      .reverse()
      .map((m) => ({ ...m, users: filterSender(m.users as ChatSender | null, user.id) }));

    // The client also filters realtime inserts with this list. It names only
    // people the viewer blocked: listing who blocked the viewer would tell
    // them they were blocked. Those authors' messages are dropped above, and
    // row-level security keeps their realtime rows from the viewer.
    return Response.json({ messages, hidden_user_ids: [...blocks.blocked] });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await socialLimiter.check(request, user.id);

    const body = await request.json().catch(() => null);
    if (typeof body?.message !== "string" || !body.message.trim() || body.message.length > 280) {
      throw new ApiError(400, "Message required (max 280 chars)");
    }
    assertCleanText(body.message, { role: user.role, label: "That message" });

    const supabase = await createSupabaseServiceClient();

    // Verify user is a current member of this team
    if (!["admin", "researcher"].includes(user.role)) {
      if (!(await isActiveMember(supabase, id, user.id))) {
        throw new ApiError(403, "Not a member of this team");
      }
    }

    const { data: msg, error } = await supabase
      .from("team_messages")
      .insert({ team_id: id, user_id: user.id, message: body.message })
      .select("*, users(id, display_name, avatar_url)")
      .single();

    if (error) {
      logger.error("team_chat.send_failed", { teamId: id, error: error.message });
      throw new ApiError(500, "Your message didn't send. Please try again.");
    }

    // Sender is the viewer here — no filtering needed on their own message.
    return Response.json({ message: msg }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
