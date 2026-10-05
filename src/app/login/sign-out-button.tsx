"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface SignOutButtonProps {
  className?: string;
  label?: string;
}

/**
 * Sign out and return to the login page. Used on screens that sit outside the
 * normal navbar (waiting for consent, account problem), so nobody is stuck
 * signed in to an account they can't use.
 */
export default function SignOutButton({ className, label = "Sign out" }: SignOutButtonProps) {
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);

  async function handleSignOut() {
    setWorking(true);
    setFailed(false);
    try {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (error) throw error;
    } catch {
      // The session is only cleared once the server call succeeds.
      setFailed(true);
      setWorking(false);
      return;
    }
    // Full navigation so every server component re-renders signed out.
    window.location.assign("/login");
  }

  return (
    <>
      <button type="button" onClick={handleSignOut} disabled={working} className={className}>
        {working ? "Signing out..." : label}
      </button>
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          Couldn&apos;t sign out. Check your connection and try again.
        </p>
      )}
    </>
  );
}
