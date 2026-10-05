import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { emailRateLimitKey, loginEmailLimiter, loginIpLimiter } from "@/lib/utils/rate-limit";
import { normalizeEmail } from "@/lib/utils/registration";
import { withLogging } from "@/lib/utils/with-logging";
import { botGuard } from "@/lib/utils/bot-guard";
import { trackEvent } from "@/lib/utils/track-event";
import { getIpHash } from "@/lib/utils/bot-detector";

export const POST = withLogging("POST /api/v1/auth/login", async (request: NextRequest) => {
  const blocked = await botGuard(request);
  if (blocked) return blocked;

  await loginIpLimiter.check(request);
  const body = await request.json();
  const { password } = body;
  const email = normalizeEmail(body.email);

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }
  // Password guessing is limited per account, not per (shared) IP.
  await loginEmailLimiter.checkKey(emailRateLimitKey(email));

  const isMobile = request.headers.get("x-client-type") === "mobile";

  if (isMobile) {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const ipHash = getIpHash(request);
      trackEvent({ eventType: "login_attempt", eventName: "Failed login (mobile)", payload: { success: false, ip_hash: ipHash, email } });
      // Also log to login_attempts table
      const svc = await createSupabaseServiceClient();
      svc.from("login_attempts").insert({ email, success: false, ip_hash: ipHash, user_agent: request.headers.get("user-agent") });
      throw new ApiError(401, "Invalid email or password");
    }

    const serviceClient = await createSupabaseServiceClient();
    const { data: profile } = await serviceClient
      .from("users")
      .select("id, role, display_name, avatar_url")
      .eq("auth_id", data.user.id)
      .is("deleted_at", null)
      .single();

    trackEvent({ userId: profile?.id, eventType: "login_attempt", eventName: "Successful login (mobile)", payload: { success: true } });

    return Response.json({
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
      },
      user: profile,
    });
  }

  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    const ipHash = getIpHash(request);
    trackEvent({ eventType: "login_attempt", eventName: "Failed login (web)", payload: { success: false, ip_hash: ipHash, email } });
    const svc = await createSupabaseServiceClient();
    svc.from("login_attempts").insert({ email, success: false, ip_hash: ipHash, user_agent: request.headers.get("user-agent") });
    throw new ApiError(401, "Invalid email or password");
  }

  const serviceClient = await createSupabaseServiceClient();
  const { data: profile } = await serviceClient
    .from("users")
    .select("id, role, display_name, avatar_url")
    .eq("auth_id", data.user.id)
    .is("deleted_at", null)
    .single();

  trackEvent({ userId: profile?.id, eventType: "login_attempt", eventName: "Successful login (web)", payload: { success: true } });

  return Response.json({ user: profile });
});
