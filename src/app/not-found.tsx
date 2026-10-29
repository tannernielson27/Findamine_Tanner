import Link from "next/link";
import Image from "next/image";
import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import LegalLinks from "@/components/legal/legal-links";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FEFCF6] px-4 py-8">
      <div className="w-full max-w-sm text-center">
        <Link href="/" className="inline-block mb-6">
          <Image
            src="/logo-findamine.png"
            alt="findamine home"
            width={160}
            height={33}
            className="h-auto mx-auto"
            style={{ objectFit: "contain" }}
          />
        </Link>

        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">
          <p className="font-[family-name:var(--font-display)] text-5xl font-bold text-brand/30">404</p>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900">
            Page not found
          </h1>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-gray-500 mt-1">
            This trail goes nowhere <Compass aria-hidden="true" className="w-4 h-4 inline text-amber-500" />
          </p>
          <p className="mt-3 text-sm text-gray-600">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          {/* Home first: this page is also what signed-out visitors see, and the
              dashboard would only bounce them to sign-in. */}
          <div className="mt-6 flex flex-col gap-3">
            <ButtonLink href="/" block>
              Go home
            </ButtonLink>
            <ButtonLink href="/dashboard" variant="secondary" block>
              Go to dashboard
            </ButtonLink>
            <ButtonLink href="/browse" variant="secondary" block>
              Browse hunts
            </ButtonLink>
          </div>
        </div>

        <LegalLinks className="mt-5" />
      </div>
    </main>
  );
}
