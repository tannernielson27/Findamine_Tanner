import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, blockChildren, errorResponse, ApiError } from "@/lib/utils/api-auth";

// Respond to friend request (accept/decline/block)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const body = await request.json().catch(() => null);
    if (!["accepted", "declined", "blocked"].includes(body?.status)) {
      throw new ApiError(400, "Status must be accepted, declined, or blocked");
    }
    if (body.status === "accepted") blockChildren(user, "friend requests");

    const supabase = await createSupabaseServiceClient();

    // Only the person who was asked can answer, and only while it is pending
    // (blocking is allowed from any state).
    let query = supabase
      .from("friend_connections")
      .update({ status: body.status })
      .eq("id", id)
      .eq("addressee_id", user.id);
    if (body.status !== "blocked") query = query.eq("status", "pending");

    const { data, error } = await query.select().maybeSingle();

    if (error) throw new ApiError(500, error.message);
    if (!data) throw new ApiError(404, "That request is no longer waiting for you.");

    return Response.json({ connection: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    const { data: row } = await supabase
      .from("friend_connections")
      .select("id, requester_id, addressee_id, status")
      .eq("id", id)
      .maybeSingle();

    const isRequester = row?.requester_id === user.id;
    const isAddressee = row?.addressee_id === user.id;
    // A requester can't clear a decline or block made by the other person
    // (that would let them simply ask again).
    const lockedByOther = isRequester && ["declined", "blocked"].includes(row?.status);
    if (!row || (!isRequester && !isAddressee) || lockedByOther) {
      throw new ApiError(404, "Connection not found");
    }

    const { error } = await supabase.from("friend_connections").delete().eq("id", id);

    if (error) throw new ApiError(500, error.message);

    return Response.json({ message: "Connection removed" });
  } catch (error) {
    return errorResponse(error);
  }
}
