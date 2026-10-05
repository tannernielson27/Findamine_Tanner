import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-6xl font-bold text-gray-200 mb-4">404</h1>
      <h2 className="text-lg font-semibold text-gray-900 mb-2">Page not found</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-sm">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      {/* Home first: this page is also what signed-out visitors see, and the
          dashboard would only bounce them to sign-in. */}
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="flex min-h-11 items-center rounded-md bg-sky-600 px-5 text-sm font-medium text-white hover:bg-sky-700"
        >
          Go Home
        </Link>
        <Link
          href="/dashboard"
          className="flex min-h-11 items-center rounded-md border border-gray-300 px-5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Go to Dashboard
        </Link>
        <Link
          href="/browse"
          className="flex min-h-11 items-center rounded-md border border-gray-300 px-5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Browse Hunts
        </Link>
      </div>
    </main>
  );
}
