import Link from "next/link";
import Image from "next/image";
import LegalLinks from "@/components/legal/legal-links";

/** Text inputs on the signed-out screens (sign in, sign up, password reset). */
export const AUTH_INPUT_CLASS =
  "block w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-base sm:text-sm focus:bg-white focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 transition";

/** Text links under the card ("Forgot password?", "Sign up"): padded to a 32px tap target. */
export const AUTH_LINK_CLASS = "inline-flex min-h-8 items-center font-medium text-brand hover:underline";

/** Logo width shared by the auth and legal pages (the launch screen is larger, as a hero). */
const AUTH_LOGO_WIDTH = 160;
// The logo file is 400x83.
const AUTH_LOGO_HEIGHT = 33;

interface AuthShellProps {
  title: string;
  /** Handwritten line under the title. */
  subtitle?: React.ReactNode;
  /** The card's contents. */
  children: React.ReactNode;
  /** Links between the card and the legal footer. */
  links?: React.ReactNode;
}

/**
 * The cream, logo-and-card layout every signed-out auth screen shares, so
 * /login, /register, /forgot-password and /reset-password look the same.
 */
export default function AuthShell({ title, subtitle, children, links }: AuthShellProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#FEFCF6] px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-4">
            <Image
              src="/logo-findamine.png"
              alt="findamine"
              width={AUTH_LOGO_WIDTH}
              height={AUTH_LOGO_HEIGHT}
              className="h-auto mx-auto"
              style={{ objectFit: "contain" }}
            />
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-gray-900">
            {title}
          </h1>
          {subtitle && (
            <p className="font-[family-name:var(--font-handwritten)] text-lg text-gray-500 mt-1">
              {subtitle}
            </p>
          )}
        </div>

        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6">{children}</div>

        <div className="text-center text-sm text-gray-500 mt-5">
          {links}
          <LegalLinks className="pt-2" />
        </div>
      </div>
    </main>
  );
}
