import type { Metadata } from "next";
import Link from "next/link";
import AuthShell from "@/app/login/auth-shell";
import { FROM_APP_PARAM, isAuthLinkType } from "@/lib/services/auth-emails";
import { safeNextPath } from "@/lib/utils/safe-next-path";

// The address of this page carries the one-time token: never pass it on in a Referer.
export const metadata: Metadata = { title: "Confirm your email", robots: { index: false }, referrer: "no-referrer" };

type Param = string | string[] | undefined;

const first = (value: Param): string => (Array.isArray(value) ? value[0] ?? "" : value ?? "");

/**
 * Where an emailed confirmation link lands. The link itself confirms nothing:
 * mail systems open links to scan them, and a link that confirmed on opening
 * would be used up (along with the code in the same email) before the person
 * ever saw it. Pressing the button posts the token to /api/auth/confirm, which
 * is what confirms the address and signs the person in.
 *
 * A plain form, so it works without scripts.
 */
export default async function ConfirmEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: Param; type?: Param; next?: Param; uid?: Param; app?: Param }>;
}) {
  const params = await searchParams;
  const tokenHash = first(params.token_hash);
  const type = first(params.type);
  const valid = Boolean(tokenHash) && isAuthLinkType(type) && type !== "recovery";

  if (!valid) {
    return (
      <AuthShell title="This link didn't work" subtitle="It may be incomplete or out of date.">
        <p className="text-center text-sm text-gray-700">
          <Link href="/login" className="font-medium text-sky-700 underline hover:text-sky-800">
            Sign in
          </Link>{" "}
          to ask for a new confirmation email.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Confirm your email" subtitle="One more step to finish setting up your account.">
      <form method="post" action="/api/auth/confirm" className="space-y-4 text-center text-sm">
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <input type="hidden" name="next" value={safeNextPath(first(params.next), "")} />
        <input type="hidden" name="uid" value={first(params.uid)} />
        {first(params.app) === "1" && <input type="hidden" name={FROM_APP_PARAM} value="1" />}
        <button
          type="submit"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-sky-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
        >
          Confirm my email
        </button>
        <p className="text-gray-500">
          Signing up in the Findamine app? You can type the code from the same email into the app instead.
        </p>
      </form>
    </AuthShell>
  );
}
