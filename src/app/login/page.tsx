"use client";

import { Suspense, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Compass } from "lucide-react";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

type ResendState = "idle" | "sending" | "sent";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [resendState, setResendState] = useState<ResendState>("idle");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkInvalid = searchParams.get("error") === "link_invalid";

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setUnconfirmed(false);
    setResendState("idle");
    setLoading(true);

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      // Supabase checks the password before confirmation, so this code only
      // appears for the right password on an unconfirmed account.
      if (error.code === "email_not_confirmed") {
        setUnconfirmed(true);
        setError("Please confirm your email first. Check your inbox for the link we sent.");
      } else {
        setError("Invalid email or password");
      }
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  async function handleResend() {
    setResendState("sending");
    try {
      await fetch("/api/v1/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setResendState("sent");
    } catch {
      setResendState("idle");
      setError("Couldn't reach the server. Please try again.");
    }
  }

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
            {linkInvalid && !error && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
                That link is invalid or has expired. Sign in to request a new one, or reset your password.
              </div>
            )}

            {error && (
              <div className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
                {error}
                {unconfirmed && (
                  <div className="mt-2">
                    {resendState === "sent" ? (
                      <span className="font-medium">A new confirmation link is on its way.</span>
                    ) : (
                      <button
                        type="button"
                        onClick={handleResend}
                        disabled={resendState === "sending"}
                        className="font-medium underline hover:no-underline disabled:opacity-50"
                      >
                        {resendState === "sending" ? "Sending..." : "Resend confirmation email"}
                      </button>
                    )}
                  </div>
                )}
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
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition-all"
                placeholder="Your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark hover:shadow-md disabled:opacity-50 transition-all"
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
            <Link href="/register" className="text-brand hover:underline font-medium">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
