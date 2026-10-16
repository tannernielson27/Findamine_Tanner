import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";
import { assertTrustedOrigin } from "@/lib/utils/origin";

const MAX_REASON = 1000;

/** Same instant, whatever the formatting (Postgres vs. JS ISO strings). */
function sameInstant(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && ta === tb;
}

/**
 * Reviewer decision on a submitted hunt (admins and researchers).
 *   { decision: "approve", review_submitted_at }                -> listed in the public catalogue
 *   { decision: "reject", reason: "...", review_submitted_at }  -> unlisted; the creator sees the reason
 * Approve and reject act on a hunt waiting for review; reject also takes an
 * approved hunt down from the catalogue. `review_submitted_at` is the value
 * the reviewer's queue showed: any edit to the hunt moves it forward, so a
 * decision on a version the reviewer never saw is refused with 409.
 * The creator is notified in-app either way.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertTrustedOrigin(request);
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json().catch(() => ({}));
    const decision = body.decision;
    if (decision !== "approve" && decision !== "reject") {
      throw new ApiError(400, 'decision must be "approve" or "reject"');
    }
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, MAX_REASON) : "";
    if (decision === "reject" && !reason) {
      throw new ApiError(400, "Give the creator a reason when rejecting a hunt");
    }
    // null only for a hunt listed before submission times were recorded.
    const seenSubmittedAt: unknown = body.review_submitted_at;
    if (
      seenSubmittedAt !== null &&
      (typeof seenSubmittedAt !== "string" || !Number.isFinite(Date.parse(seenSubmittedAt)))
    ) {
      throw new ApiError(400, "review_submitted_at (from the review queue) is required");
    }

    const supabase = await createSupabaseServiceClient();

    const { data: hunt } = await supabase
      .from("hunts")
      .select("id, title, status, review_status, review_submitted_at, created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.status === "draft") {
      throw new ApiError(409, "This hunt is a draft again; there is nothing to review");
    }
    if (decision === "approve" && hunt.review_status !== "pending") {
      throw new ApiError(409, "Only a hunt waiting for review can be approved");
    }
    if (decision === "reject" && hunt.review_status !== "pending" && hunt.review_status !== "approved") {
      throw new ApiError(409, "Only a hunt waiting for review, or a listed one, can be rejected");
    }
    const unchanged =
      hunt.review_submitted_at === null
        ? seenSubmittedAt === null && hunt.review_status === "approved"
        : sameInstant(hunt.review_submitted_at, seenSubmittedAt);
    if (!unchanged) {
      throw new ApiError(409, "This hunt changed since you loaded it. Reload the queue and review the latest version.");
    }

    const approve = decision === "approve";
    // Conditional on the state just checked, so an edit landing between the
    // read and this write can't be approved unseen.
    const conditional = supabase
      .from("hunts")
      .update({
        review_status: approve ? "approved" : "rejected",
        review_reason: approve ? (reason || null) : reason,
        reviewed_at: new Date().toISOString(),
        reviewed_by: user.id,
        is_public: approve,
      })
      .eq("id", id)
      .eq("review_status", hunt.review_status);
    const { data: updated, error } = await (hunt.review_submitted_at === null
      ? conditional.is("review_submitted_at", null)
      : conditional.eq("review_submitted_at", hunt.review_submitted_at)
    )
      .select()
      .maybeSingle();
    if (error) {
      logger.error("hunt_review.update_failed", { huntId: id, error: error.message });
      throw new ApiError(500, "Couldn't save the decision. Please try again.");
    }
    if (!updated) {
      throw new ApiError(409, "This hunt changed since you loaded it. Reload the queue and review the latest version.");
    }

    // The decision stands even if the notification fails; just log it.
    const { error: notifyError } = await supabase.from("notifications").insert({
      user_id: hunt.created_by,
      type: approve ? "hunt_review_approved" : "hunt_review_rejected",
      title: approve
        ? `"${hunt.title}" is now listed in Discover`
        : `"${hunt.title}" wasn't approved for Discover`,
      body: approve
        ? "A reviewer approved your hunt. Anyone can now find and play it."
        : `Reviewer note: ${reason} Until it is approved, only you can open it. Edit it and publish again to resubmit.`,
      entity_type: "hunt",
      entity_id: id,
    });
    if (notifyError) {
      logger.error("hunt_review.notify_failed", { huntId: id, error: notifyError.message });
    }

    return Response.json({ hunt: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
