import Link from "next/link";

const ERROR_COPY: Record<string, { title: string; body: string }> = {
  invalid: {
    title: "This link didn't work",
    body: "This consent link is invalid or has expired. Please open the most recent email we sent you and use the button in it. If it still doesn't work, please contact the teacher or organizer who set up the account.",
  },
  rate_limited: {
    title: "Please try again shortly",
    body: "This link has been opened too many times in a short while. Wait a few minutes, then open it again.",
  },
  failed: {
    title: "Something went wrong",
    body: "We couldn't record your consent just now. Nothing has changed. Please open the link from your email again in a few minutes.",
  },
};

export default async function ConsentVerifiedPage({
  searchParams,
}: {
  searchParams: Promise<{ success?: string; already?: string; error?: string }>;
}) {
  const params = await searchParams;
  const alreadyVerified = params.already === "true";
  const problem = params.error ? ERROR_COPY[params.error] ?? ERROR_COPY.invalid : null;

  if (problem) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm space-y-6 text-center">
          <div className="text-5xl" aria-hidden="true">⚠️</div>
          <h1 className="text-xl font-bold text-gray-900">{problem.title}</h1>
          <p className="text-gray-600">{problem.body}</p>
          <Link
            href="/login"
            className="inline-block rounded-md bg-sky-600 px-6 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="text-5xl">{alreadyVerified ? "👍" : "✅"}</div>
        <h1 className="text-xl font-bold text-gray-900">
          {alreadyVerified ? "Already Verified" : "Consent Verified!"}
        </h1>
        <p className="text-gray-600">
          {alreadyVerified
            ? "This account has already been verified. Your child can sign in and start exploring."
            : "Your child's account is now active. They can sign in and start exploring findamine!"}
        </p>
        <div className="rounded-lg bg-green-50 p-4">
          <p className="text-sm text-green-800 font-medium mb-1">What your child can do:</p>
          <ul className="text-sm text-green-700 space-y-1 text-left">
            <li>Join and play scavenger hunts</li>
            <li>Answer challenges and earn points</li>
            <li>Collaborate with teammates</li>
          </ul>
          <p className="text-sm text-green-700 mt-2 text-left">
            <strong>Privacy protected:</strong> Photos stay on their device,
            they appear as codenames on leaderboards, and social features are restricted.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="inline-block rounded-md bg-sky-600 px-6 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          Go to Dashboard
        </Link>
      </div>
    </main>
  );
}
