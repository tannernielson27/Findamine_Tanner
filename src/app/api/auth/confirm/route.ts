import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { isAuthLinkType, safeNextPath } from "@/lib/services/auth-emails";
import { logger } from "@/lib/utils/logger";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True when the account the link was issued for has a confirmed email. A dead
 * confirmation link on a confirmed account almost always means something else
 * (a mail link scanner, a double click, another device) used it first.
 */
async function isAlreadyConfirmed(authUserId: string | null): Promise<boolean> {
  if (!authUserId || !UUID_PATTERN.test(authUserId)) return false;
  try {
    const supabase = await createSupabaseServiceClient();
    const { data } = await supabase.auth.admin.getUserById(authUserId);
    return Boolean(data?.user?.email_confirmed_at);
  } catch (error) {
    logger.error("auth.confirm.lookup_failed", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

function loginRedirect(origin: string, params: Record<string, string>, next: string | null): NextResponse {
  const query = new URLSearchParams(params);
  const safeNext = safeNextPath(next, "");
  if (safeNext) query.set("next", safeNext);
  return NextResponse.redirect(`${origin}/login?${query.toString()}`);
}

/**
 * Landing point for emailed auth links (verification, resend, password reset).
 * Exchanges the one-time token hash for a session cookie, then redirects.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = searchParams.get("next");

  if (!tokenHash || !isAuthLinkType(type)) {
    return loginRedirect(origin, { error: "link_invalid" }, null);
  }

  // A reset token is NOT spent on this GET: mail link scanners open links
  // before the person does, and a spent reset token cannot be recovered from.
  // The reset page exchanges it only when the new password is submitted.
  if (type === "recovery") {
    const query = new URLSearchParams({ token_hash: tokenHash });
    return NextResponse.redirect(`${origin}/reset-password?${query.toString()}`);
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (!error) {
    return NextResponse.redirect(`${origin}${safeNextPath(next, "/dashboard")}`);
  }

  // The link is dead. If the email is confirmed anyway, the link did its job
  // already and all that is left is to sign in.
  if (await isAlreadyConfirmed(searchParams.get("uid"))) {
    return loginRedirect(origin, { notice: "confirmed" }, next);
  }
  return loginRedirect(origin, { error: "confirm_link_invalid" }, next);
}
