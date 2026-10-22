import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions } from "@/lib/auth/session";

export function createSupabaseBrowserClient() {
  const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Persistent, secure (on https), sameSite=lax session cookies.
    { cookieOptions: authCookieOptions(isHttps) }
  );
}
