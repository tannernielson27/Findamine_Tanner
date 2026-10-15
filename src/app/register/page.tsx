"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { MapPin, Users } from "lucide-react";
import { postJson } from "@/app/login/auth-client";

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
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref")?.trim().toUpperCase() || "";
  // Deep link to return to after confirming; the server validates it.
  const next = searchParams.get("next") || "";
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";
  // Self-registered players confirm their age: teens 13+, adults 18+.
  const needsDob = role === "teen" || role === "adult";

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
        date_of_birth: needsDob ? dateOfBirth : undefined,
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
      <main className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-bold text-gray-900">Check your email</h1>
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
          <p className="text-sm text-gray-500">
            It can take a minute to arrive. Check your spam or junk folder too.
          </p>
          {referralCode && outcome.referralApplied === false && (
            <p className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-sm text-amber-800">
              Your account was created, but invite code <strong>{referralCode}</strong> wasn&apos;t
              recognized, so it wasn&apos;t applied. Ask your friend to check their code.
            </p>
          )}
          {referralCode && outcome.referralApplied === true && (
            <p className="rounded-xl bg-sky-50 border border-sky-100 p-3 text-sm text-sky-800">
              Invite code <strong>{referralCode}</strong> was applied.
            </p>
          )}
          <Link
            href={loginHref}
            className="inline-block text-sm text-sky-600 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FEFCF6] px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-4">
            <Image src="/logo-findamine.png" alt="findamine" width={160} height={40} className="h-auto mx-auto" style={{ objectFit: "contain" }} />
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900">
            Join the Adventure
          </h1>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-gray-500 mt-1">
            Create your explorer account <MapPin className="w-4 h-4 inline text-amber-500" />
          </p>
        </div>

        {/* Form card */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
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
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
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
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
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
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
                placeholder="At least 8 characters"
              />
            </div>

            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700 mb-1">
                I am a...
              </label>
              <select
                id="role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
              >
                <option value="adult">College student / adult player (18+)</option>
                <option value="teen">Teen player (13-17)</option>
                <option value="teacher">Teacher / instructor</option>
                <option value="parent">Parent</option>
              </select>
            </div>

            {needsDob && (
              <div>
                <label htmlFor="dob" className="block text-sm font-medium text-gray-700 mb-1">
                  Date of birth
                </label>
                <input
                  id="dob"
                  type="date"
                  required
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date().toISOString().split("T")[0]}
                  className="block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition"
                />
                <p className="mt-1.5 text-xs text-gray-500">
                  {role === "adult"
                    ? "Adult accounts are for players 18 or older."
                    : "You must be 13 or older to create your own account."}
                </p>
              </div>
            )}

            {role === "teen" && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-800">
                <strong>Under 13?</strong> You can&apos;t create an account here yourself.
                Please ask a parent or teacher for help.
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (needsDob && !dateOfBirth)}
              className="w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark hover:shadow-md disabled:opacity-50 transition"
            >
              {loading ? "Creating account..." : "Start Exploring"}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500 mt-5">
          Already have an account?{" "}
          <Link href={loginHref} className="text-brand hover:underline font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
