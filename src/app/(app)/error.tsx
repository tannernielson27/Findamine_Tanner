"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Compass } from "lucide-react";
import { logger } from "@/lib/utils/logger";

// Boundary for every signed-in page. It sits inside (app)/layout.tsx, so the
// navbar (and with it the way to Privacy, Settings and Sign out) stays on
// screen when a page fails.
export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Detail goes to the console, never to the page.
    logger.error("route_error", {
      boundary: "app",
      path: window.location.pathname,
      errorMessage: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-light text-brand-dark">
        <Compass className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text text-balance">
        We lost the trail for a moment
      </h1>
      <p className="mt-2 max-w-sm text-base text-themed-muted">
        This page didn&apos;t load the way it should have. Try again, or head back to your
        dashboard.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={() => unstable_retry()}
          className="min-h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center rounded-xl border border-themed-border px-5 text-sm font-medium text-themed-text transition-colors hover:bg-themed-bg"
        >
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
