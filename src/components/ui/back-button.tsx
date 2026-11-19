"use client";

/**
 * The app's Back control. Every page that sits outside the tab bar, or that a
 * player reaches from more than one place, gets one: inside the iOS and
 * Android shells there is no browser back button, so a page without its own
 * way out is a dead end.
 *
 * Goes back to where the player came from. When there is no earlier in-app
 * page (deep link, fresh tab, app cold start) it goes to `fallbackHref`
 * instead; see lib/navigation/in-app-history. It is a real link to the
 * fallback, so it still works before the page's scripts have loaded.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import { ArrowLeft } from "lucide-react";
import { goBack } from "@/lib/navigation/in-app-history";
import { cn } from "@/lib/utils/cn";

interface BackButtonProps {
  /** Where Back goes when there is no earlier in-app page to return to. */
  fallbackHref: string;
  /** Visible text, which is also the accessible name. */
  label?: string;
  className?: string;
}

/** A click meant to open the link somewhere else (new tab, new window, download). */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

export function BackButton({ fallbackHref, label = "Back", className }: BackButtonProps) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (opensElsewhere(event)) return;
    event.preventDefault();
    goBack({ fallbackHref, replace: (href) => router.replace(href) });
  }

  return (
    <Link
      href={fallbackHref}
      prefetch={false}
      onClick={handleClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-full border border-themed-border bg-surface pl-3 pr-4 text-sm font-semibold text-themed-text no-underline transition-colors duration-150 hover:border-themed-text/30 hover:bg-themed-text/5 active:bg-themed-text/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        className
      )}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" strokeWidth={2.2} aria-hidden="true" />
      {label}
    </Link>
  );
}
