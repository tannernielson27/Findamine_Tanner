import Link from "next/link";
import { PRIVACY_PATH, TERMS_PATH } from "@/lib/constants/legal";
import { cn } from "@/lib/utils/cn";

const LINK_CLASS = "inline-flex min-h-8 items-center hover:text-gray-700 hover:underline";

/**
 * "Privacy Policy · Terms of Use" footer for the signed-out screens (launch,
 * sign in, sign up, password reset). Each link is at least 32px tall so it is
 * an easy tap target without making the text bigger.
 */
export default function LegalLinks({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-gray-500", className)}>
      <Link href={PRIVACY_PATH} className={LINK_CLASS}>
        Privacy Policy
      </Link>
      <span aria-hidden="true" className="mx-2">&middot;</span>
      <Link href={TERMS_PATH} className={LINK_CLASS}>
        Terms of Use
      </Link>
    </p>
  );
}
