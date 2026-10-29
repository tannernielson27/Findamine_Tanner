"use client";

import { useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/app/login/auth-client";
import AuthShell, { AUTH_INPUT_CLASS, AUTH_LINK_CLASS } from "@/app/login/auth-shell";

const backToSignIn = (
  <p>
    <Link href="/login" className={AUTH_LINK_CLASS}>
      Back to sign in
    </Link>
  </p>
);

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await postJson(
      "/api/v1/auth/forgot-password",
      { email: email.trim().toLowerCase() },
      "We couldn't send the reset link. Please check the address and try again."
    );
    setLoading(false);

    // Only a request the server accepted may show "Check your email".
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="A reset link is on its way" links={backToSignIn}>
        <p className="text-sm text-gray-600 text-center">
          If an account exists for <strong>{email.trim().toLowerCase()}</strong>, we sent a password
          reset link. It can take a minute to arrive; check your spam folder too.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset password"
      subtitle={
        <>
          We&apos;ll get you back on the trail <KeyRound aria-hidden="true" className="w-4 h-4 inline text-amber-500" />
        </>
      }
      links={backToSignIn}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-gray-600">
          Enter your email and we&apos;ll send a reset link.
        </p>

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
            {error}
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
            className={AUTH_INPUT_CLASS}
            placeholder="you@example.com"
          />
        </div>

        <Button type="submit" block disabled={loading}>
          {loading ? "Sending..." : "Send reset link"}
        </Button>
      </form>
    </AuthShell>
  );
}
