import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account deleted",
  robots: { index: false },
};

/** Where the settings page sends someone after DELETE /api/v1/account. */
export default function AccountDeletedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-xl font-bold text-gray-900">Your account has been deleted</h1>
        <p className="text-gray-600">
          Your Findamine account and the data that belonged to it have been permanently deleted, and
          you&apos;ve been signed out. Thanks for exploring with us.
        </p>
        <Link
          href="/"
          className="inline-block min-h-11 rounded-md bg-sky-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-sky-700"
        >
          Back to the home page
        </Link>
      </div>
    </main>
  );
}
