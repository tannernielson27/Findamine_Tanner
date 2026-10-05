import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { emailRateLimitKey, registerEmailLimiter, registerIpLimiter } from "@/lib/utils/rate-limit";
import { withLogging } from "@/lib/utils/with-logging";
import { botGuard } from "@/lib/utils/bot-guard";
import { trackEvent } from "@/lib/utils/track-event";
import { enrollParticipant } from "@/lib/services/enrollment";
import { redeemReferral } from "@/lib/services/referral";
import {
  isPlausibleEmail,
  normalizeEmail,
  resolveSelfRegisterRole,
  wasCreatedDuringRequest,
} from "@/lib/utils/registration";
import { logger } from "@/lib/utils/logger";
import {
  buildAuthConfirmUrl,
  resolveSiteUrl,
  safeNextPath,
  sendVerificationEmail,
} from "@/lib/services/auth-emails";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const EMAIL_FAILED_MESSAGE = "We couldn't send your confirmation email. Please try again in a few minutes.";

async function findProfileByAuthId(supabase: ServiceClient, authUserId: string) {
  return supabase
    .from("users")
    .select("id, display_name, deleted_at")
    .eq("auth_id", authUserId)
    .maybeSingle();
}

/**
 * The address already belongs to an account that never confirmed its email
 * (generateLink handed back that user with a fresh token). Nothing is created
 * or deleted: the person just gets a new confirmation link.
 */
async function resendToExistingAccount(
  profile: { display_name: string | null; deleted_at: string | null },
  email: string,
  confirmUrl: string
): Promise<Response> {
  if (profile.deleted_at) {
    throw new ApiError(409, "An account with this email already exists");
  }
  const sent = await sendVerificationEmail({ to: email, displayName: profile.display_name, confirmUrl });
  if (!sent.success) {
    logger.error("auth.register.resend_email_failed", { error: sent.error });
    throw new ApiError(503, EMAIL_FAILED_MESSAGE);
  }
  return Response.json({
    resent: true,
    message:
      "You already started signing up with this email, so we've re-sent your confirmation link. The password you chose the first time still applies.",
  });
}

export const POST = withLogging("POST /api/v1/auth/register", async (request: NextRequest) => {
  const blocked = await botGuard(request);
  if (blocked) return blocked;

  const requestStartedAt = Date.now();
  await registerIpLimiter.check(request);
  const body = await request.json();
  const { password, display_name, role, date_of_birth } = body;
  const email = normalizeEmail(body.email);

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }
  if (!isPlausibleEmail(email)) {
    throw new ApiError(400, "Please enter a valid email address");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw new ApiError(400, "Password must be at least 8 characters");
  }

  // Validate DOB if provided for any role
  if (date_of_birth) {
    const dob = new Date(date_of_birth);
    if (isNaN(dob.getTime())) {
      throw new ApiError(400, "Invalid date of birth");
    }
    if (dob.getTime() > Date.now()) {
      throw new ApiError(400, "Date of birth cannot be in the future");
    }
  }

  // Teens must be 13+, adults 18+ (an 18+ "teen" becomes an adult player).
  const resolved = resolveSelfRegisterRole(role, date_of_birth);
  if (!resolved.ok) {
    throw new ApiError(resolved.status, resolved.message);
  }
  const userRole = resolved.role;

  // Resolve before creating anything so a misconfigured deploy leaves no orphans.
  const siteUrl = resolveSiteUrl(request.nextUrl.origin);
  const supabase = await createSupabaseServiceClient();
  // Counted only once the form is valid: from here on every attempt can put a
  // message in this inbox, whoever is asking.
  await registerEmailLimiter.checkKey(emailRateLimitKey(email));

  // generateLink creates the unconfirmed auth user and returns its one-time
  // confirmation token without sending mail; we send the email ourselves.
  // For an address that signed up before but never confirmed, it returns that
  // EXISTING user (password untouched) with a fresh token instead of an error.
  const { data: link, error: authError } =
    await supabase.auth.admin.generateLink({ type: "signup", email, password });

  if (authError) {
    if (authError.code === "email_exists" || authError.message.includes("already")) {
      throw new ApiError(409, "An account with this email already exists. Try signing in instead.");
    }
    logger.error("auth.register.link_failed", { error: authError.message });
    throw new ApiError(400, "We couldn't create your account. Please check your details and try again.");
  }

  const authUserId = link.user.id;
  // Only an auth user created by THIS request may be rolled back below.
  const createdNow = wasCreatedDuringRequest(link.user.created_at, requestStartedAt);
  const confirmUrl = buildAuthConfirmUrl(
    siteUrl,
    link.properties.hashed_token,
    "signup",
    safeNextPath(typeof body.next === "string" ? body.next : null, "/dashboard"),
    authUserId
  );

  const { data: existingProfile } = await findProfileByAuthId(supabase, authUserId);
  if (existingProfile) {
    return resendToExistingAccount(existingProfile, email, confirmUrl);
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .insert({
      auth_id: authUserId,
      email,
      display_name: display_name || null,
      role: userRole,
      date_of_birth: date_of_birth || null,
    })
    .select()
    .single();

  if (userError) {
    // A parallel submit of the same form may have won the insert. If a profile
    // now points at this auth user, deleting the auth user would cascade to it.
    const { data: racedProfile, error: lookupError } = await findProfileByAuthId(supabase, authUserId);
    if (racedProfile) {
      return resendToExistingAccount(racedProfile, email, confirmUrl);
    }
    logger.error("auth.register.profile_failed", { code: userError.code, error: userError.message });
    if (createdNow && !lookupError) {
      await supabase.auth.admin.deleteUser(authUserId);
    }
    if (userError.code === "23505") {
      throw new ApiError(409, "An account with this email already exists. Try signing in instead.");
    }
    throw new ApiError(500, "We couldn't finish creating your account. Please try again.");
  }

  const sent = await sendVerificationEmail({
    to: email,
    displayName: display_name || null,
    confirmUrl,
  });

  if (!sent.success) {
    // Without the email the account can never be confirmed; undo what this
    // request created so the person can simply try again.
    logger.error("auth.register.email_failed", { error: sent.error });
    await supabase.from("users").delete().eq("id", user.id);
    if (createdNow) {
      await supabase.auth.admin.deleteUser(authUserId);
    }
    throw new ApiError(503, EMAIL_FAILED_MESSAGE);
  }

  // Adult players get the adult age band (themes, privacy defaults, export).
  if (userRole === "adult") {
    await supabase
      .from("user_profiles")
      .upsert({ user_id: user.id, age_band: "adult" }, { onConflict: "user_id" });
  }

  // Assign treatment + enroll at signup (idempotent; never throws). The (app)
  // layout re-runs this on first authenticated load as a safety net.
  await enrollParticipant(user.id);

  // Optional: if the user arrived via a referral link, link them to the recruiter.
  // A bad code never fails registration, but the person is told it didn't apply.
  let referralApplied: boolean | undefined;
  if (body.referral_code && typeof body.referral_code === "string") {
    const redeemed = await redeemReferral(user.id, body.referral_code);
    referralApplied = redeemed?.ok === true;
  }

  return Response.json(
    {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
      },
      message: "Account created. Check your email for a confirmation link.",
      ...(referralApplied === undefined ? {} : { referral_applied: referralApplied }),
    },
    { status: 201 }
  );
});
