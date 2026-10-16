import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail } from "@/components/legal/legal-page";
import { TERMS_PATH } from "@/lib/constants/legal";
import SignOutButton from "./sign-out-button";

export const metadata: Metadata = {
  title: "Account unavailable",
  robots: { index: false },
};

/** Where src/proxy.ts sends a signed-in account that is suspended, banned or inactive. */
export default function AccountSuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6 text-center">
        <h1 className="text-xl font-bold text-gray-900">Your account is unavailable</h1>
        <p className="text-gray-600">
          This account has been suspended or closed, usually because of a breach of our{" "}
          <Link href={TERMS_PATH} className="text-brand hover:underline">Terms of Use</Link>. If you
          think this is a mistake, contact us at <ContactEmail />.
        </p>
        <SignOutButton />
      </div>
    </main>
  );
}
