"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { forgetPushDevice } from "@/lib/native/push";

/**
 * Sign out, as the old navbar did: drop this phone's push token while the
 * session is still valid (iOS app), end the Supabase session, go to the
 * landing page. Returns the action plus a pending flag for the button.
 */
export function useSignOut(): { signOut: () => Promise<void>; signingOut: boolean; error: string } {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");

  const signOut = useCallback(async () => {
    setSigningOut(true);
    setError("");
    try {
      // A push-token failure must never block signing out.
      await forgetPushDevice().catch(() => {});
      const supabase = createSupabaseBrowserClient();
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't sign you out. Check your connection and try again.");
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  return { signOut, signingOut, error };
}
