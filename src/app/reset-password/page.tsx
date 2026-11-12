"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import { NETWORK_ERROR_MESSAGE, describePasswordUpdateError } from "@/app/login/auth-client";
import AuthShell, { AUTH_INPUT_CLASS, AUTH_LINK_CLASS } from "@/app/login/auth-shell";
import { isPhoneBrowserOutsideApp } from "@/lib/native/user-agent";

const backToSignIn = (
  <p>
    <Link href="/login" className={AUTH_LINK_CLASS}>
      Back to sign in
    </Link>
  </p>
);

const MIN_PASSWORD_LENGTH = 8;

type LinkStatus = "checking" | "ready" | "invalid" | "done";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<LinkStatus>("checking");
  const router = useRouter();
  // The one-time token from the emailed link. It is exchanged for a session
  // only when the form is submitted, so a mail scanner that merely opens the
  // link cannot use it up before the person gets here.
  const pendingToken = useRef<string | null>(null);
  // Set when the reset was asked for from the phone app (see /api/auth/confirm).
  const fromApp = useRef(false);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const tokenHash = query.get("token_hash");
    pendingToken.current = tokenHash;
    fromApp.current = query.get("app") === "1";

    const supabase = createSupabaseBrowserClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });
    // With a token in the URL the form can be shown straight away (the token
    // is checked on submit). Without one, only an existing session can proceed.
    const canProceed: Promise<boolean> = tokenHash
      ? Promise.resolve(true)
      : supabase.auth
          .getUser()
          .then(({ data }) => Boolean(data.user))
          .catch(() => false);
    canProceed.then((allowed) => {
      setStatus((current) => (current === "ready" || allowed ? "ready" : "invalid"));
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }

    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();

      if (pendingToken.current) {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          token_hash: pendingToken.current,
          type: "recovery",
        });
        if (verifyError) {
          const status = verifyError.status ?? 0;
          const transient =
            verifyError.name === "AuthRetryableFetchError" || status === 0 || status === 429 || status >= 500;
          if (transient) {
            // The token may still be good: let them try again.
            setError(describePasswordUpdateError(verifyError));
          } else {
            // Used or expired: show the "send a new link" screen.
            setStatus("invalid");
          }
          setLoading(false);
          return;
        }
        // Spent. A retry (e.g. after a rejected password) reuses the session.
        pendingToken.current = null;
        window.history.replaceState(null, "", "/reset-password");
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setError(describePasswordUpdateError(error));
        setLoading(false);
        return;
      }
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
      setLoading(false);
      return;
    }

    // A reset link opened from a mail app lands in Safari or Chrome, not in the
    // Findamine app: the new password works there, but the app is still signed
    // out, so say so instead of carrying on in the browser.
    if (fromApp.current && isPhoneBrowserOutsideApp(navigator.userAgent, navigator.maxTouchPoints)) {
      setStatus("done");
      setLoading(false);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  if (status === "done") {
    return (
      <AuthShell title="Password updated">
        <div className="space-y-4 text-center text-sm">
          <p className="text-gray-700">
            <strong>Using the Findamine app?</strong> Go back to the app now and sign in there with your new
            password.
          </p>
          <p className="text-gray-500">Using findamine on the web instead? You&apos;re already signed in here.</p>
          <ButtonLink href="/dashboard" variant="secondary" block>
            Continue in this browser
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  if (status === "checking") {
    return (
      <AuthShell title="Reset password" links={backToSignIn}>
        <p role="status" className="text-sm text-gray-500 text-center">Verifying reset link...</p>
      </AuthShell>
    );
  }

  if (status === "invalid") {
    return (
      <AuthShell title="Link expired" links={backToSignIn}>
        <div className="space-y-4 text-center">
          <p className="text-sm text-gray-600">
            This reset link is invalid, has expired, or has already been used.
          </p>
          <ButtonLink href="/forgot-password" block>
            Send a new reset link
          </ButtonLink>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set new password"
      subtitle={
        <>
          Almost back on the trail <KeyRound aria-hidden="true" className="w-4 h-4 inline text-amber-500" />
        </>
      }
      links={backToSignIn}
    >
      <form onSubmit={handleReset} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            New password
          </label>
          <input
            id="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          />
        </div>

        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-gray-700 mb-1">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            required
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={AUTH_INPUT_CLASS}
            placeholder="Type it again"
          />
        </div>

        <Button type="submit" block disabled={loading}>
          {loading ? "Updating..." : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
