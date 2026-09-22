import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAuthLinkType, safeNextPath } from "@/lib/services/auth-emails";

/**
 * Landing point for emailed auth links (verification, resend, password reset).
 * Exchanges the one-time token hash for a session cookie, then redirects.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (tokenHash && isAuthLinkType(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) {
      const fallback = type === "recovery" ? "/reset-password" : "/dashboard";
      return NextResponse.redirect(`${origin}${safeNextPath(searchParams.get("next"), fallback)}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link_invalid`);
}
