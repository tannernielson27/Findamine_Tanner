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
export function useSignOut(): { signOut: () => Promise<void>; signingOut: boolean } {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await forgetPushDevice();
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      router.push("/");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  return { signOut, signingOut };
}
