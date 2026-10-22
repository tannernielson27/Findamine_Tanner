"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { HomeGreeting } from "@/components/home/home-greeting";
import { cn } from "@/lib/utils/cn";
import NotificationBell from "./notification-bell";
import SurveyNudge from "./survey-nudge";
import { activeTabHref, shellChromeFor, tabsFor, type NavUser } from "./nav-links";
import { TAB_ICONS } from "./tab-icons";
import { tabAnchor } from "@/lib/onboarding/steps";

export interface ShellUser extends NavUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface TopBarProps {
  user: ShellUser | null;
}

function Logo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex min-h-12 shrink-0 items-center rounded-lg">
      <Image
        src="/logo-findamine.png"
        alt="findamine"
        width={120}
        height={28}
        className="max-h-[28px] w-auto"
        style={{ objectFit: "contain", height: "28px" }}
        priority
      />
    </Link>
  );
}

/**
 * Top-right controls on every tab screen: survey nudge (only when a survey is
 * due) and the notification bell. Privacy settings live in the Profile tab
 * (see showPrivacyProfileRow).
 */
function HeaderActions() {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <SurveyNudge />
      <NotificationBell />
    </div>
  );
}

/** lg+ only: the tab destinations as a slim inline nav. */
function DesktopNav({ user, pathname }: { user: ShellUser; pathname: string }) {
  const tabs = tabsFor(user);
  const active = activeTabHref(tabs, pathname);
  return (
    <nav aria-label="Main" className="hidden min-w-0 items-center gap-1 lg:flex">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.icon];
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            data-tour-anchor={tabAnchor(tab.icon)}
            className={cn(
              "flex h-12 items-center gap-2 whitespace-nowrap rounded-full px-4 text-base transition-colors duration-150",
              current ? "bg-brand-light font-bold text-brand-dark" : "font-semibold text-themed-muted hover:bg-themed-text/5 hover:text-themed-text"
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={current ? 2.2 : 2} aria-hidden="true" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * The app's header. Replaces the old navbar + hamburger: logo (or, on Home
 * below lg, the greeting) on the left, bell + Privacy shield on the right.
 * Everything that was in the hamburger now lives in the Profile tab.
 *
 * Keeps the `fm-app-header` class: globals.css pads the page top for the
 * iPhone status bar only when this header is absent (play, hunt detail).
 */
export default function TopBar({ user }: TopBarProps) {
  const pathname = usePathname();
  const chrome = shellChromeFor(pathname);
  if (!chrome.topBar) return null;

  if (!user) {
    return (
      <header className="fm-app-header sticky top-0 z-40 border-b border-themed-border bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
          <Logo href="/" />
          <div className="flex items-center gap-1">
            <Link href="/login" className="flex min-h-12 items-center rounded-lg px-3 text-base font-medium text-themed-text hover:bg-themed-text/5">
              Sign in
            </Link>
            <Link href="/register" className="flex min-h-12 items-center rounded-full bg-brand px-5 text-base font-semibold text-white hover:bg-brand-dark">
              Sign up
            </Link>
          </div>
        </div>
      </header>
    );
  }

  const isHome = pathname === "/dashboard";

  if (isHome) {
    // Phones: the mockup's greeting row (scrolls away with the page).
    // lg+: the same sticky logo + nav bar as every other screen, greeting below.
    return (
      <>
        <header className="fm-app-header relative z-40 bg-themed-bg pt-[env(safe-area-inset-top)] lg:sticky lg:top-0 lg:border-b lg:border-themed-border lg:bg-white/95 lg:backdrop-blur-md">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 pb-5 pt-3 lg:h-16 lg:px-4 lg:py-0">
            <div className="min-w-0 lg:hidden">
              <HomeGreeting displayName={user.display_name} />
            </div>
            <div className="hidden min-w-0 items-center gap-6 lg:flex">
              <Logo href="/dashboard" />
              <DesktopNav user={user} pathname={pathname} />
            </div>
            <HeaderActions />
          </div>
        </header>
        <div className="mx-auto hidden max-w-6xl px-4 pb-5 pt-8 lg:block">
          <HomeGreeting displayName={user.display_name} />
        </div>
      </>
    );
  }

  return (
    <header className="fm-app-header sticky top-0 z-40 border-b border-themed-border bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-6">
          <Logo href="/dashboard" />
          <DesktopNav user={user} pathname={pathname} />
        </div>
        <HeaderActions />
      </div>
    </header>
  );
}
