import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { parseFindFields } from "../../../find-fields";
import {
  assertCleanFindText,
  FIND_REVIEW_KEYS,
  findTextChanged,
  requeuedMessage,
  settleRequeue,
} from "@/lib/hunts/review";
import { internalError } from "@/lib/utils/internal-error";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findId: string }> }
) {
  try {
    const { id, findId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Verify hunt ownership
    const { data: hunt } = await supabase
      .from("hunts")
      .select("created_by, status, review_status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only edit finds in your own hunts");
    }

    const updates = parseFindFields(body);
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "No editable fields provided");
    }
    assertCleanFindText(updates);

    // On a listed hunt, note whether this edit changes what reviewers approved
    // (the finds trigger applies the same rule in the database, and moves a
    // pending hunt's review_submitted_at forward on any such edit).
    const wasListed = hunt.review_status === "approved" && hunt.status !== "draft";
    let predicted = false;
    if (wasListed) {
      const { data: before } = await supabase
        .from("finds")
        .select(FIND_REVIEW_KEYS.join(", "))
        .eq("id", findId)
        .eq("hunt_id", id)
        .maybeSingle();
      predicted = !!before && findTextChanged(before as unknown as Record<string, unknown>, updates);
    }

    const { data: find, error } = await supabase
      .from("finds")
      .update(updates)
      .eq("id", findId)
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .select("*, locations(*), tasks(*), primers(*)")
      .maybeSingle();

    if (error) throw internalError("/api/v1/hunts/[id]/finds/[findId]", error);
    if (!find) throw new ApiError(404, "Stop not found in this hunt");

    if (await settleRequeue(supabase, id, wasListed, predicted)) {
      return Response.json({ find, review_status: "pending", message: requeuedMessage(user.id, hunt.created_by) });
    }

    return Response.json({ find });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; findId: string }> }
) {
  try {
    const { id, findId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const supabase = await createSupabaseServiceClient();

    // Verify hunt ownership
    const { data: hunt } = await supabase
      .from("hunts")
      .select("created_by, status, review_status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only delete finds in your own hunts");
    }

    const { data: removed, error } = await supabase
      .from("finds")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", findId)
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .select("id");

    if (error) throw internalError("/api/v1/hunts/[id]/finds/[findId]", error);
    if (!removed || removed.length === 0) throw new ApiError(404, "Stop not found in this hunt");

    return Response.json({ message: "Find deleted" });
  } catch (error) {
    return errorResponse(error);
  }
}
