"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronDown, MapPin, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postJson } from "@/app/login/auth-client";
import AuthShell, { AUTH_INPUT_CLASS, AUTH_LINK_CLASS } from "@/app/login/auth-shell";

type Outcome = { resent: boolean; referralApplied: boolean | null };

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("adult");
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref")?.trim().toUpperCase() || "";
  // Deep link to return to after confirming; the server validates it.
  const next = searchParams.get("next") || "";
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  // Self-registered players confirm their age range: teens 13+, adults 18+.
  // No date of birth is asked for (App Store guideline 5.1.1(v)).
  const needsAgeConfirm = role === "teen" || role === "adult";

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    // postJson never throws: a dropped connection or a non-JSON error page
    // comes back as a message instead of leaving the button stuck.
    const result = await postJson(
      "/api/v1/auth/register",
      {
        email: email.trim().toLowerCase(),
        password,
        display_name: displayName,
        role,
        age_confirmed: needsAgeConfirm ? ageConfirmed : undefined,
        referral_code: referralCode || undefined,
        next: next || undefined,
      },
      "Registration failed. Please check your details and try again."
    );
    setLoading(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    const applied = result.data.referral_applied;
    setOutcome({
      resent: result.data.resent === true,
      referralApplied: typeof applied === "boolean" ? applied : null,
    });
  }

  if (outcome) {
    return (
      <AuthShell
        title="Check your email"
        subtitle="One more step to start exploring"
        links={
          <p>
            <Link href={loginHref} className={AUTH_LINK_CLASS}>
              Back to sign in
            </Link>
          </p>
        }
      >
        <div className="space-y-4 text-center text-sm">
          {outcome.resent ? (
            <p className="text-gray-600">
              You already started signing up with <strong>{email.trim().toLowerCase()}</strong>, so
              we&apos;ve re-sent your confirmation link. The password you chose the first time
              still applies; if you don&apos;t remember it, you can reset it after confirming.
            </p>
          ) : (
            <p className="text-gray-600">
              We sent a verification link to <strong>{email.trim().toLowerCase()}</strong>. Click the
              link to activate your account.
            </p>
          )}
          <p className="text-gray-500">
            It can take a minute to arrive. Check your spam or junk folder too.
          </p>
          {referralCode && outcome.referralApplied === false && (
            <p className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-amber-800">
              Your account was created, but invite code <strong>{referralCode}</strong> wasn&apos;t
              recognized, so it wasn&apos;t applied. Ask your friend to check their code.
            </p>
          )}
          {referralCode && outcome.referralApplied === true && (
            <p className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-sky-800">
              Invite code <strong>{referralCode}</strong> was applied.
            </p>
          )}
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Join the adventure"
      subtitle={
        <>
          Create your explorer account <MapPin aria-hidden="true" className="w-4 h-4 inline text-amber-500" />
        </>
      }
      links={
        <p>
          Already have an account?{" "}
          <Link href={loginHref} className={AUTH_LINK_CLASS}>
            Sign in
          </Link>
        </p>
      }
    >
      <form onSubmit={handleRegister} className="space-y-4">
        {error && (
          <div role="alert" className="rounded-xl bg-red-50 border border-red-100 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {referralCode && (
          <div className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-sm text-sky-800 flex items-center gap-2">
            <Users className="w-4 h-4 shrink-0" />
            <span>
              Invited by a friend — we&apos;ll check code <strong>{referralCode}</strong> when
              you join and tell you if it was applied.
            </span>
          </div>
        )}

        <div>
          <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
            Explorer name
          </label>
          <input
            id="displayName"
            type="text"
            required
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={AUTH_INPUT_CLASS}
            placeholder="Your display name"
          />
        </div>

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
            className={AUTH_INPUT_CLASS}
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={AUTH_INPUT_CLASS}
            placeholder="At least 8 characters"
          />
        </div>

        <div>
          <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
            I am a...
          </label>
          {/* appearance-none so the select matches the inputs' height and
              text inset on every browser; the chevron replaces the native one. */}
          <div className="relative">
            <select
              id="role"
              value={role}
              onChange={(e) => {
                setRole(e.target.value);
                setAgeConfirmed(false);
              }}
              className={`${AUTH_INPUT_CLASS} appearance-none pr-10`}
            >
              <option value="adult">College student / adult player (18+)</option>
              <option value="teen">Teen player (13-17)</option>
              <option value="teacher">Teacher / instructor</option>
              <option value="parent">Parent</option>
            </select>
            <ChevronDown
              aria-hidden="true"
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500"
            />
          </div>
        </div>

        {needsAgeConfirm && (
          <label htmlFor="ageConfirm" className="flex items-start gap-2.5 text-sm text-gray-700">
            <input
              id="ageConfirm"
              type="checkbox"
              required
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand focus:ring-brand/30"
            />
            <span>
              {role === "adult" ? "I confirm I am 18 or older." : "I confirm I am 13 or older."}
            </span>
          </label>
        )}

        {role === "teen" && (
          <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
            <strong>Under 13?</strong> You can&apos;t create an account here yourself.
            Please ask a parent or teacher for help.
          </div>
        )}

        <Button type="submit" block disabled={loading || (needsAgeConfirm && !ageConfirmed)}>
          {loading ? "Creating account..." : "Start exploring"}
        </Button>

        <p className="text-center text-xs text-gray-500">
          By creating an account you agree to the{" "}
          <Link href="/terms" className="text-brand hover:underline font-medium">Terms of Use</Link>
          {" "}and{" "}
          <Link href="/privacy" className="text-brand hover:underline font-medium">Privacy Policy</Link>.
        </p>
      </form>
    </AuthShell>
  );
}
