import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { authEmailIpLimiter, authEmailLimiter, emailRateLimitKey } from "@/lib/utils/rate-limit";
import { escapeLikePattern, normalizeEmail } from "@/lib/utils/registration";
import { withLogging } from "@/lib/utils/with-logging";
import { botGuard } from "@/lib/utils/bot-guard";
import { logger } from "@/lib/utils/logger";
import {
  buildAuthConfirmUrl,
  resolveSiteUrl,
  sendVerificationEmail,
} from "@/lib/services/auth-emails";

const GENERIC_RESPONSE = { message: "If that account still needs confirming, a new link is on its way." };

/**
 * Re-send the account confirmation link. A magic link confirms an unconfirmed
 * address when it is used, and unlike a signup link it needs no password.
 * The response never reveals whether the address has an account.
 */
export const POST = withLogging("POST /api/v1/auth/resend-verification", async (request: NextRequest) => {
  const blocked = await botGuard(request);
  if (blocked) return blocked;

  await authEmailIpLimiter.check(request);
  const body = await request.json();
  const email = normalizeEmail(body.email);
  if (!email) {
    throw new ApiError(400, "Email is required");
  }
  // Keyed on the inbox being mailed, so one person can't be flooded and a
  // shared campus IP doesn't use up everyone else's resends.
  await authEmailLimiter.checkKey(`resend:${emailRateLimitKey(email)}`);

  const siteUrl = resolveSiteUrl(request.nextUrl.origin);
  const supabase = await createSupabaseServiceClient();

  // Look the account up first: generateLink must never create a user here.
  const { data: profile } = await supabase
    .from("users")
    .select("auth_id, display_name")
    // Case-insensitive: rows created before emails were normalized may hold
    // the address exactly as it was typed.
    .ilike("email", escapeLikePattern(email))
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!profile?.auth_id) return Response.json(GENERIC_RESPONSE);

  const { data: authUser } = await supabase.auth.admin.getUserById(profile.auth_id);
  if (!authUser?.user?.email || authUser.user.email_confirmed_at) {
    return Response.json(GENERIC_RESPONSE);
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: authUser.user.email,
  });
  if (error) {
    logger.error("auth.resend_verification.link_failed", { error: error.message });
    return Response.json(GENERIC_RESPONSE);
  }

  const result = await sendVerificationEmail({
    to: authUser.user.email,
    displayName: profile.display_name ?? null,
    confirmUrl: buildAuthConfirmUrl(siteUrl, data.properties.hashed_token, "magiclink", "/dashboard", profile.auth_id),
  });
  if (!result.success) {
    logger.error("auth.resend_verification.email_failed", { error: result.error });
  }

  return Response.json(GENERIC_RESPONSE);
});
