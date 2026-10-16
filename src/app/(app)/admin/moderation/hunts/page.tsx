import Link from "next/link";
import { getAdminAreaRole } from "../../_lib/admin-access";
import HuntReviewQueue from "./hunt-review-queue";

/** Publish review: approve or reject hunts before they are listed in Discover. */
export default async function HuntReviewPage() {
  // Admins and researchers both review hunts; anyone else is redirected.
  await getAdminAreaRole();

  return (
    <main className="mx-auto max-w-4xl px-4 py-4">
      <Link href="/admin" className="text-sm text-brand hover:underline mb-4 inline-block">
        &larr; Admin
      </Link>
      <h1 className="text-lg font-semibold text-gray-900 mb-1">Hunt Review</h1>
      <p className="text-sm text-gray-600 mb-4">
        Published hunts are playable by their creator and the creator&apos;s classes right away, but only
        appear in Discover once approved here. Taking down an approved hunt removes it from Discover.
      </p>
      <HuntReviewQueue />
    </main>
  );
}
