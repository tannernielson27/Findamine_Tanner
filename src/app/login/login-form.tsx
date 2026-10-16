"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Compass } from "lucide-react";
import { NETWORK_ERROR_MESSAGE, describeSignInError, postJson } from "./auth-client";

export type LoginNotice = "confirmed" | "link_invalid" | "callback_failed" | null;

type ResendState = "idle" | "sending" | "sent";

interface LoginFormProps {
  /** Where to go after signing in. Already validated as a same-origin path. */
  next: string;
  notice: LoginNotice;
}

const INPUT_CLASS =
  "block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition";

export default function LoginForm({ next, notice }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [resendError, setResendError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const registerHref = next === "/dashboard" ? "/register" : `/register?next=${encodeURIComponent(next)}`;

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUnconfirmed(false);
    setResendState("idle");
    setResendError("");
    setLoading(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        // Supabase checks the password before confirmation, so this code only
        // appears for the right password on an unconfirmed account.
        if (error.code === "email_not_confirmed") {
          setUnconfirmed(true);
          setError("Please confirm your email first. Check your inbox for the link we sent.");
        } else {
          setError(describeSignInError(error));
        }
        setLoading(false);
        return;
      }
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function handleResend() {
    const address = email.trim().toLowerCase();
    setResendError("");
    if (!address) {
      setResendError("Enter your email address above first.");
      return;
    }
    setResendState("sending");
    const result = await postJson(
      "/api/v1/auth/resend-verification",
      { email: address },
      "We couldn't send the email. Please try again."
    );
    if (!result.ok) {
      setResendState("idle");
      setResendError(result.error);
      return;
    }
    setResendState("sent");
  }

  const resendControl =
    resendState === "sent" ? (
      <span className="font-medium">
        If this account still needs confirming, a new link is on its way. Check your spam folder too.
      </span>
    ) : (
      <>
        <button
          type="button"
          onClick={handleResend}
          disabled={resendState === "sending"}
          className="font-medium underline hover:no-underline disabled:opacity-50"
        >
          {resendState === "sending" ? "Sending..." : "Resend confirmation email"}
        </button>
        {resendError && <span className="mt-1 block">{resendError}</span>}
      </>
    );

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FEFCF6] px-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-4">
            <Image src="/logo-findamine.png" alt="findamine" width={160} height={40} className="h-auto mx-auto" style={{ objectFit: "contain" }} />
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900">
            Welcome Back
          </h1>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-gray-500 mt-1">
            Your adventure continues <Compass className="w-4 h-4 inline text-amber-500" />
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
          <form onSubmit={handleLogin} className="space-y-4">
            {notice === "confirmed" && !error && (
              <div role="status" className="rounded-xl bg-green-50 border border-green-100 p-3 text-sm text-green-800">
                Your email is confirmed. Please sign in to continue.
              </div>
            )}

            {notice === "link_invalid" && !error && (
              <div role="status" className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                That link is invalid or has expired. If you&apos;ve already confirmed your email, just sign in.
                Otherwise enter your email below and we&apos;ll send a new confirmation link.
                <div className="mt-2">{resendControl}</div>
              </div>
            )}

            {notice === "callback_failed" && !error && (
              <div role="status" className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                We couldn&apos;t finish signing you in. Please try again.
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
                {error}
                {unconfirmed && <div className="mt-2">{resendControl}</div>}
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={INPUT_CLASS}
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={INPUT_CLASS}
                placeholder="Your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark hover:shadow-md disabled:opacity-50 transition"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>

        {/* Links */}
        <div className="text-center text-sm text-gray-500 mt-5 space-y-2">
          <p>
            <Link href="/forgot-password" className="text-brand hover:underline font-medium">
              Forgot password?
            </Link>
          </p>
          <p>
            Don&apos;t have an account?{" "}
            <Link href={registerHref} className="text-brand hover:underline font-medium">
              Sign up
            </Link>
          </p>
          <p className="pt-2 text-xs">
            <Link href="/privacy" className="hover:text-gray-700 hover:underline">Privacy Policy</Link>
            <span aria-hidden="true" className="mx-2">&middot;</span>
            <Link href="/terms" className="hover:text-gray-700 hover:underline">Terms of Use</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
