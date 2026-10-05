import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { canSeeAnswerKeys, redactAnswerKeys } from "../redact-finds";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServiceClient();

    const { data: hunt, error } = await supabase
      .from("hunts")
      .select("*, finds(*, locations(*), tasks(*), primers(*))")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !hunt) throw new ApiError(404, "Hunt not found");

    const user = await getAuthUser(request);

    // Draft/unpublished hunts are only visible to their owner or admins
    if (hunt.status === "draft") {
      if (
        !user ||
        (hunt.created_by !== user.id &&
          !["admin", "researcher"].includes(user.role))
      ) {
        throw new ApiError(404, "Hunt not found");
      }
    }

    // Removed stops are soft-deleted; never hand them back. Then sort by order.
    if (hunt.finds) {
      hunt.finds = (hunt.finds as { sort_order: number; deleted_at: string | null }[])
        .filter((f) => !f.deleted_at)
        .sort((a, b) => a.sort_order - b.sort_order);
      if (!canSeeAnswerKeys(user, hunt.created_by)) {
        hunt.finds = redactAnswerKeys(hunt.finds);
      }
    }

    return Response.json({ hunt });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from("hunts")
      .select("created_by, status")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!existing) throw new ApiError(404, "Hunt not found");
    if (
      existing.created_by !== user.id &&
      !["admin", "researcher"].includes(user.role)
    ) {
      throw new ApiError(403, "Not authorized to edit this hunt");
    }

    const allowedFields = [
      "title", "description", "target_audience", "play_mode",
      "center_latitude", "center_longitude", "search_radius_km",
      "estimated_duration_min", "grade_range_min", "grade_range_max",
      "subject_domains", "max_teams", "min_team_size", "max_team_size",
      "allow_late_join", "identity_mode", "is_template", "metadata",
      "theme", "theme_narrative", "difficulty_progression",
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (updates.title !== undefined) {
      if (typeof updates.title !== "string" || !updates.title.trim()) {
        throw new ApiError(400, "Hunt title cannot be empty");
      }
      updates.title = updates.title.trim();
    }
    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "No editable fields provided");
    }

    const { data: hunt, error } = await supabase
      .from("hunts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ hunt });
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
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const supabase = await createSupabaseServiceClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from("hunts")
      .select("created_by")
      .eq("id", id)
      .single();

    if (!existing) throw new ApiError(404, "Hunt not found");
    if (
      existing.created_by !== user.id &&
      !["admin", "researcher"].includes(user.role)
    ) {
      throw new ApiError(403, "Not authorized to delete this hunt");
    }

    // Soft delete
    const { error } = await supabase
      .from("hunts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new ApiError(500, error.message);

    return Response.json({ message: "Hunt deleted" });
  } catch (error) {
    return errorResponse(error);
  }
}
