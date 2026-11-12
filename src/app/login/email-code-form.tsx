"use client";

import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  EMAIL_CODE_MIN_LENGTH,
  NETWORK_ERROR_MESSAGE,
  cleanEmailCode,
  describeEmailCodeError,
} from "./auth-client";
import { AUTH_INPUT_CLASS } from "./auth-shell";

/**
 * "email" confirms a new account (from a signup or a resent magic-link email);
 * "recovery" signs in from a password-reset email.
 */
export type EmailCodePurpose = "email" | "recovery";

interface EmailCodeFormProps {
  /** The address the code was mailed to. */
  email: string;
  purpose: EmailCodePurpose;
  /** Called once the code is accepted and the session cookie is set. */
  onVerified: () => void;
  /** Shown when a code fails, e.g. "Already confirmed with the link? Sign in." */
  failureHint?: React.ReactNode;
  /** Focus the code box on mount (when it appears after a tap). */
  autoFocus?: boolean;
}

/** Re-enable the button if the page has not navigated away by then. */
const NAVIGATION_GRACE_MS = 5000;

/**
 * Typed alternative to the emailed link. On a phone the link opens in Safari,
 * which signs the person in there and not in the Findamine app; the code keeps
 * them in the app. It is the same one-time token as the link, so using either
 * one spends both.
 */
export default function EmailCodeForm({ email, purpose, onVerified, failureHint, autoFocus }: EmailCodeFormProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const inputId = `email-code-${purpose}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const address = email.trim().toLowerCase();
    if (!address) {
      setError("Enter your email address first.");
      return;
    }
    if (code.length < EMAIL_CODE_MIN_LENGTH) {
      setError(`Enter the ${EMAIL_CODE_MIN_LENGTH}-digit code from the email.`);
      return;
    }

    setLoading(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { error: verifyError } = await supabase.auth.verifyOtp({ email: address, token: code, type: purpose });
      if (verifyError) {
        setError(describeEmailCodeError(verifyError));
        setLoading(false);
        return;
      }
    } catch {
      setError(NETWORK_ERROR_MESSAGE);
      setLoading(false);
      return;
    }
    // The caller navigates away; keep the button disabled meanwhile so the
    // spent code isn't sent twice, but don't leave it dead if nothing happens.
    onVerified();
    window.setTimeout(() => setLoading(false), NAVIGATION_GRACE_MS);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-left" noValidate>
      <label htmlFor={inputId} className="block text-sm font-medium text-gray-700">
        Code from the email
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        required
        autoFocus={autoFocus}
        value={code}
        onChange={(e) => setCode(cleanEmailCode(e.target.value))}
        className={`${AUTH_INPUT_CLASS} text-center font-mono text-lg tracking-[0.4em]`}
        placeholder="123456"
      />
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
          {error}
          {failureHint && <div className="mt-1">{failureHint}</div>}
        </div>
      )}
      <Button type="submit" block disabled={loading}>
        {loading ? "Checking..." : purpose === "recovery" ? "Continue" : "Confirm my account"}
      </Button>
    </form>
  );
}
