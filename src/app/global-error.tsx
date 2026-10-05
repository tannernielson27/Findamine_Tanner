"use client";

import { useEffect } from "react";
import "./globals.css";
import { logger } from "@/lib/utils/logger";

// Last-resort boundary: replaces the root layout when it (or anything no other
// boundary caught) throws, so it must render its own <html> and <body>.
// Plain <a> rather than <Link>: the router itself may be what failed.
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    // Detail goes to the console, never to the page.
    logger.error("route_error", {
      boundary: "global",
      errorMessage: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body className="antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif", fontSize: "16px" }}>
        <title>Something went wrong | findamine</title>
        <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900 mb-2">
            Something went wrong
          </h1>
          <p className="text-base text-gray-500 mb-6 max-w-sm">
            findamine hit an unexpected problem. Please try again.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              onClick={() => unstable_retry()}
              className="min-h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-dark"
            >
              Try again
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- the router may be the thing that failed */}
            <a
              href="/"
              className="flex min-h-11 items-center rounded-xl border border-gray-300 px-5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              Go home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
