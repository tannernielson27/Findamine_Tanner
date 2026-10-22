import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Compass } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { launchRedirect } from "@/lib/auth/session";
import { selectHeroBanner, getHeroBannerContext } from "@/lib/services/hero-banner";

/**
 * The launch screen: `/` is the iOS app's start URL and the PWA's start_url.
 * Signed-in people never see it (src/proxy.ts redirects them to the app; the
 * check below is the backstop). Everyone else gets one app-style screen: the
 * scene art for their place and time of day, the brand, and two ways in.
 */
export default async function Welcome() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  const launchTo = launchRedirect("/", Boolean(user));
  if (launchTo) redirect(launchTo);

  const hero = selectHeroBanner(getHeroBannerContext(await headers()));

  return (
    <main className="fm-launch flex flex-col bg-[#FEFCF6]">
      {/* Scene art: fills whatever height the actions leave over. */}
      <div className="fm-launch-art relative min-h-44 flex-1 overflow-hidden">
        <Image src={hero.src} alt={hero.alt} fill priority sizes="100vw" className="object-cover" />
        <div className="absolute inset-0 bg-gradient-to-b from-[#FEFCF6]/10 via-[#FEFCF6]/20 to-[#FEFCF6]" />
      </div>

      <section
        aria-labelledby="welcome-heading"
        className="fm-stagger relative mx-auto -mt-10 flex w-full max-w-sm flex-col items-center px-6 pb-4 text-center"
      >
        <Image
          src="/logo-findamine.png"
          alt="findamine"
          width={180}
          height={37}
          priority
          className="h-auto"
          style={{ objectFit: "contain" }}
        />

        <div className="mt-4">
          <h1
            id="welcome-heading"
            className="font-[family-name:var(--font-display)] text-[28px] font-bold leading-tight text-gray-900"
          >
            Turn the world into your classroom
          </h1>
          <p className="mt-1 font-[family-name:var(--font-handwritten)] text-xl text-gray-500">
            GPS scavenger hunts for curious explorers{" "}
            <Compass aria-hidden="true" className="inline h-4 w-4 text-amber-500" />
          </p>
        </div>

        <div className="mt-7 flex w-full flex-col gap-3">
          <ButtonLink href="/register" size="lg" block className="shadow-md shadow-brand/25">
            Get started
          </ButtonLink>
          <ButtonLink href="/login" variant="secondary" size="lg" block>
            I already have an account
          </ButtonLink>
        </div>

        <p className="mt-6 text-xs text-gray-500">
          <Link href="/privacy" className="inline-flex min-h-8 items-center hover:text-gray-700 hover:underline">
            Privacy Policy
          </Link>
          <span aria-hidden="true" className="mx-2">&middot;</span>
          <Link href="/terms" className="inline-flex min-h-8 items-center hover:text-gray-700 hover:underline">
            Terms of Use
          </Link>
        </p>
      </section>
    </main>
  );
}
