import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { errorResponse, ApiError } from "@/lib/utils/api-auth";
import { authEmailIpLimiter, authEmailLimiter, emailRateLimitKey } from "@/lib/utils/rate-limit";
import { normalizeEmail } from "@/lib/utils/registration";
import { logger } from "@/lib/utils/logger";
import {
  buildAuthConfirmUrl,
  resolveSiteUrl,
  sendPasswordResetEmail,
} from "@/lib/services/auth-emails";

const GENERIC_RESPONSE = { message: "If an account exists, a reset link has been sent." };

export async function POST(request: NextRequest) {
  try {
    await authEmailIpLimiter.check(request);
    const body = await request.json();
    const email = normalizeEmail(body.email);

    if (!email) {
      throw new ApiError(400, "Email is required");
    }
    // Keyed on the inbox being mailed; applies whether or not an account exists.
    await authEmailLimiter.checkKey(`recovery:${emailRateLimitKey(email)}`);

    const siteUrl = resolveSiteUrl(request.nextUrl.origin);
    const supabase = await createSupabaseServiceClient();
    const { data, error } = await supabase.auth.admin.generateLink({ type: "recovery", email });

    if (error) {
      // Unknown addresses get the same response to prevent email enumeration.
      if (error.code !== "user_not_found") {
        logger.error("auth.forgot_password.link_failed", { error: error.message });
      }
      return Response.json(GENERIC_RESPONSE);
    }

    const result = await sendPasswordResetEmail({
      to: email,
      confirmUrl: buildAuthConfirmUrl(siteUrl, data.properties.hashed_token, "recovery", "/reset-password"),
    });
    if (!result.success) {
      logger.error("auth.forgot_password.email_failed", { error: result.error });
    }

    return Response.json(GENERIC_RESPONSE);
  } catch (error) {
    return errorResponse(error);
  }
}
