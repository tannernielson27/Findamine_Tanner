import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { canSeeAnswerKeys, redactAnswerKeys } from "../redact-finds";
import {
  canAccessHunt,
  changedReviewedHuntFields,
  isReviewer,
  requeuedMessage,
  REVIEWED_HUNT_FIELDS,
  REVIEWED_HUNT_TEXT_FIELDS,
  settleRequeue,
  withoutInternalReviewFields,
} from "@/lib/hunts/review";
import { firstFlagged } from "@/lib/hunts/text-filter";
import { logger } from "@/lib/utils/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServiceClient();

    // The hunt and the caller's session are independent: look both up at once.
    const [{ data: hunt, error }, user] = await Promise.all([
      supabase
        .from("hunts")
        .select("*, finds(*, locations(*), tasks(*), primers(*))")
        .eq("id", id)
        .is("deleted_at", null)
        .single(),
      getAuthUser(request),
    ]);

    if (error || !hunt) throw new ApiError(404, "Hunt not found");

    // Drafts: owner and reviewers only. Published but not yet approved for the
    // public catalogue: also the creator's roster students.
    if (!(await canAccessHunt(supabase, hunt, user))) {
      throw new ApiError(404, "Hunt not found");
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

    const insider = !!user && (user.id === hunt.created_by || isReviewer(user.role));
    return Response.json({ hunt: insider ? hunt : withoutInternalReviewFields(hunt) });
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
    const { data: existingRow } = await supabase
      .from("hunts")
      .select(`created_by, status, review_status, ${REVIEWED_HUNT_FIELDS.join(", ")}`)
      .eq("id", id)
      .is("deleted_at", null)
      .single();
    const existing = existingRow as unknown as
      | ({ created_by: string; status: string; review_status: string | null } & Record<string, unknown>)
      | null;

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

    const before: Record<string, unknown> = existing;
    const textEdits = REVIEWED_HUNT_TEXT_FIELDS.filter(
      (field) => updates[field] !== undefined && updates[field] !== before[field]
    );
    const flagged = firstFlagged(
      textEdits.map((field) => ({
        label: `the ${field === "theme_narrative" ? "story" : field}`,
        text: typeof updates[field] === "string" ? (updates[field] as string) : null,
      }))
    );
    if (flagged) {
      throw new ApiError(400, `${flagged[0].toUpperCase()}${flagged.slice(1)} contains language that isn't allowed on Findamine.`);
    }

    const { data: hunt, error } = await supabase
      .from("hunts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      logger.error("hunt.update_failed", { huntId: id, error: error.message });
      throw new ApiError(500, "Couldn't save the hunt. Please try again.");
    }

    // Reviewers approved the old wording and settings (audience, play mode,
    // grades, place...): changing any of them on a listed hunt takes it out of
    // the catalogue until it is reviewed again. The database trigger enforces
    // this (and moves review_submitted_at forward on edits to a pending hunt);
    // settleRequeue reads what happened so the response tells the editor.
    const wasListed = existing.review_status === "approved" && existing.status !== "draft";
    const predicted = changedReviewedHuntFields(before, updates).length > 0;
    if (await settleRequeue(supabase, id, wasListed, predicted)) {
      return Response.json({
        hunt: { ...hunt, review_status: "pending", is_public: false },
        review_status: "pending",
        message: requeuedMessage(user.id, existing.created_by),
      });
    }

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

    if (error) {
      logger.error("hunt.delete_failed", { huntId: id, error: error.message });
      throw new ApiError(500, "Couldn't delete the hunt. Please try again.");
    }

    return Response.json({ message: "Hunt deleted" });
  } catch (error) {
    return errorResponse(error);
  }
}
