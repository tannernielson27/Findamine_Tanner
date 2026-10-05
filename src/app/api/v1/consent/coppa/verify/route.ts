import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { consentVerifyLimiter } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/utils/logger";

type ConsentOutcome = "success" | "already" | "invalid" | "rate_limited" | "failed";

/**
 * This link is opened by a parent in a browser, so every outcome (including
 * errors) lands on the human-readable /consent-verified page, never raw JSON.
 */
function resultRedirect(outcome: ConsentOutcome): Response {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://findamine.app").replace(/\/+$/, "");
  const query =
    outcome === "success" ? "success=true" : outcome === "already" ? "already=true" : `error=${outcome}`;
  return Response.redirect(`${siteUrl}/consent-verified?${query}`);
}

/**
 * Verify parental consent via email link.
 * Parent clicks link with token -> consent verified -> child account activated.
 */
export async function GET(request: NextRequest) {
  try {
    await consentVerifyLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");
    const childId = searchParams.get("child_id");

    if (!token || !childId) {
      return resultRedirect("invalid");
    }

    const supabase = await createSupabaseServiceClient();

    // Find consent record scoped to THIS child with matching token
    const { data: consent } = await supabase
      .from("consent_records")
      .select("id, user_id, granted, verified_at")
      .eq("consent_type", "parental")
      .eq("child_id", childId)
      .eq("verification_token", token)
      .is("revoked_at", null)
      .maybeSingle();

    if (!consent) {
      return resultRedirect("invalid");
    }

    // Prevent re-verification
    if (consent.verified_at) {
      return resultRedirect("already");
    }

    // Mark consent as granted and verified
    const { error: consentError } = await supabase
      .from("consent_records")
      .update({
        granted: true,
        verified_at: new Date().toISOString(),
      })
      .eq("id", consent.id);

    if (consentError) {
      logger.error("consent.coppa_verify.update_failed", { error: consentError.message });
      return resultRedirect("failed");
    }

    // Verify the parent-child link
    await supabase
      .from("parent_child_links")
      .update({ verified: true })
      .eq("parent_id", consent.user_id)
      .eq("child_id", childId);

    // Activate the child's account
    await supabase
      .from("users")
      .update({ status: "active" })
      .eq("id", childId)
      .eq("status", "pending_consent"); // Only activate if still pending

    return resultRedirect("success");
  } catch (error) {
    if (error instanceof ApiError && error.statusCode === 429) {
      return resultRedirect("rate_limited");
    }
    logger.error("consent.coppa_verify.failed", { error: error instanceof Error ? error.message : String(error) });
    return resultRedirect("failed");
  }
}
