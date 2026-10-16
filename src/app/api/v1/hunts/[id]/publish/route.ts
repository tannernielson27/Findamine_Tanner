import { NextRequest, after } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { notifyReviewersOfPendingHunt } from "@/lib/moderation/notify";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { firstFlagged } from "@/lib/hunts/text-filter";
import { huntTextForReview, isReviewer, pendingReviewFields } from "@/lib/hunts/review";
import { publishLimiter } from "@/lib/utils/rate-limit";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { logger } from "@/lib/utils/logger";

/**
 * Publish a hunt. For teachers and hunt creators this makes the hunt playable
 * (by them, reviewers, and their roster students) and submits it for review;
 * it only joins the public catalogue once a reviewer approves it
 * (POST /hunts/{id}/review). Admins and researchers are the reviewers, so
 * their own publishes are approved immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertTrustedOrigin(request);
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");
    await publishLimiter.check(request, user.id);

    const supabase = await createSupabaseServiceClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from("hunts")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!existing) throw new ApiError(404, "Hunt not found");
    if (existing.created_by !== user.id && !isReviewer(user.role)) {
      throw new ApiError(403, "You can only publish your own hunts");
    }
    // Already live and approved: nothing to resubmit.
    if (existing.status !== "draft" && existing.review_status === "approved") {
      return Response.json({ hunt: existing, review_status: "approved" });
    }

    // The creator must affirm every stop is safe to reach (PublishSafetyCheck).
    const body = await request.json().catch(() => null);
    if (body?.safety_affirmed !== true) {
      throw new ApiError(
        400,
        "Confirm that every stop is on public, safe, accessible ground before submitting this hunt."
      );
    }

    // Verify the hunt is actually playable: at least one stop, and every stop
    // has a real location players can walk to.
    const { data: finds, error: findsError } = await supabase
      .from("finds")
      .select(
        "id, sort_order, location_id, metadata, clue_text, clue_hints, tasks(title, description, content, feedback), primers(title, content), locations(name, description, address, safety_notes)"
      )
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    if (findsError) {
      logger.error("hunt.publish.finds_failed", { huntId: id, error: findsError.message });
      throw new ApiError(500, "Couldn't check this hunt's stops. Please try again.");
    }
    if (!finds || finds.length === 0) {
      throw new ApiError(400, "Add at least one stop before publishing this hunt");
    }

    type FindRow = { location_id: string | null; metadata: unknown };
    /** e.g. "stop 3 has" / "stops 1, 2 have" for the stops matching a problem, or "" if none. */
    const stopsThat = (matches: (find: FindRow) => boolean) => {
      const numbers = finds.flatMap((find, index) => (matches(find) ? [index + 1] : []));
      if (numbers.length === 0) return "";
      return numbers.length === 1 ? `stop ${numbers[0]} has` : `stops ${numbers.join(", ")} have`;
    };

    const missingLocation = stopsThat((f) => !f.location_id);
    if (missingLocation) {
      throw new ApiError(400, `Can't publish yet: ${missingLocation} no location. Edit to set one.`);
    }
    const needsPlacement = stopsThat(
      (f) => (f.metadata as { needs_placement?: boolean } | null)?.needs_placement === true
    );
    if (needsPlacement) {
      throw new ApiError(
        400,
        `Can't publish yet: ${needsPlacement} a placeholder location from the AI builder. Edit and move the pin to the real spot.`
      );
    }

    // Screen the author's text before anything goes to a reviewer or a player.
    // PostgREST returns a to-one embed as an object; normalise defensively.
    const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
    const flagged = firstFlagged(
      huntTextForReview(
        existing,
        finds.map((f) => ({ ...f, tasks: one(f.tasks), primers: one(f.primers), locations: one(f.locations) }))
      )
    );
    if (flagged) {
      throw new ApiError(
        400,
        `Can't publish: ${flagged} contains language that isn't allowed on Findamine. Edit it and try again.`
      );
    }

    const now = new Date();
    const affirmation = { safety_affirmed_at: now.toISOString(), safety_affirmed_by: user.id };
    const updates = isReviewer(user.role)
      ? {
          status: "published",
          ...affirmation,
          is_public: true,
          review_status: "approved",
          review_reason: null,
          review_submitted_at: now.toISOString(),
          reviewed_at: now.toISOString(),
          reviewed_by: user.id,
        }
      : { status: "published", ...affirmation, ...pendingReviewFields(now) };

    const { data: hunt, error } = await supabase
      .from("hunts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      logger.error("hunt.publish.update_failed", { huntId: id, error: error.message });
      throw new ApiError(500, "Couldn't publish this hunt. Please try again.");
    }

    if (updates.review_status === "pending") {
      after(() => notifyReviewersOfPendingHunt(supabase, id));
    }

    return Response.json({ hunt, review_status: updates.review_status });
  } catch (error) {
    return errorResponse(error);
  }
}
