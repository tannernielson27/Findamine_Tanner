import type { Metadata } from "next";
import { MailCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import AuthShell from "@/app/login/auth-shell";
import { safeNextPath } from "@/lib/utils/safe-next-path";

export const metadata: Metadata = { title: "Email confirmed", robots: { index: false } };

type Param = string | string[] | undefined;

/**
 * Where /api/auth/confirm lands a confirmation link opened in a phone browser
 * instead of the Findamine app. Mail apps open links in Safari or Chrome, so
 * the browser is signed in while the app (its own web view, its own cookies)
 * is not. Say so plainly instead of dropping the person into the website.
 */
export default async function EmailConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ continue?: Param }>;
}) {
  const { continue: raw } = await searchParams;
  const continueTo = safeNextPath(Array.isArray(raw) ? raw[0] : raw, "/dashboard");

  return (
    <AuthShell
      title="Email confirmed"
      subtitle={
        <>
          You&apos;re all set <MailCheck aria-hidden="true" className="w-4 h-4 inline text-amber-500" />
        </>
      }
    >
      <div className="space-y-4 text-center text-sm">
        <p className="text-gray-700">
          <strong>Signed up in the Findamine app?</strong> Go back to the app now and sign in there with
          your email and password.
        </p>
        <p className="text-gray-500">Using findamine on the web instead? Carry on here.</p>
        <ButtonLink href={continueTo} variant="secondary" block>
          Continue in this browser
        </ButtonLink>
      </div>
    </AuthShell>
  );
}
