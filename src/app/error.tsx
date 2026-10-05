"use client";

import { useEffect } from "react";
import Link from "next/link";
import { logger } from "@/lib/utils/logger";

// Root-segment boundary: catches errors on pages outside the (app) group
// (landing, login, register…). Signed-in pages have their own boundary in
// (app)/error.tsx, which keeps the navbar.
export default function RootError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Detail goes to the console, never to the page.
    logger.error("route_error", {
      boundary: "root",
      errorMessage: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 mb-2">
        Something went wrong
      </h1>
      <p className="text-base text-gray-500 mb-6 max-w-sm">
        That didn&apos;t load the way it should have. Please try again.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <button
          onClick={() => unstable_retry()}
          className="min-h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
        >
          Try again
        </button>
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-xl border border-gray-300 px-5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
