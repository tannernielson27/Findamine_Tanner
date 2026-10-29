"use client";

import Link from "next/link";
import { ChevronRight, FileText, Heart, Lock, LogOut, ScrollText, Settings, ShieldCheck, Users, UsersRound, type LucideIcon } from "lucide-react";
import { profileLinksFor, type NavUser, type ProfileLinkIcon } from "@/components/layout/nav-links";
import { useSignOut } from "@/components/layout/sign-out";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<ProfileLinkIcon, LucideIcon> = {
  settings: Settings,
  privacy: Lock,
  social: Heart,
  teams: UsersRound,
  rosters: Users,
  admin: ShieldCheck,
  policy: FileText,
  terms: ScrollText,
};

// 68px min: the height of a row with a subtitle, so title-only rows (Privacy
// Policy, Terms of Use, Sign out) line up with the rest.
const ROW = "flex min-h-[68px] w-full items-center gap-3.5 px-4 py-3 text-left text-themed-text no-underline transition-colors duration-150 hover:bg-themed-bg";

/**
 * Profile's settings list: what used to be in the hamburger menu (Settings,
 * Rosters, Admin, legal links, sign out) plus Social and Teams from the old
 * Home shortcuts, and Privacy settings (hidden for high friction: see
 * showPrivacyProfileRow).
 */
export function SettingsList({ role, user }: { role: string; user?: Pick<NavUser, "privacy_friction" | "metadata"> | null }) {
  const { signOut, signingOut, error } = useSignOut();
  const links = profileLinksFor(role, user);

  return (
    <nav aria-label="Profile and settings" className="mt-7">
      <ul className="m-0 list-none overflow-hidden rounded-card border border-themed-border bg-surface p-0">
        {links.map((link, i) => {
          const Icon = ICONS[link.icon];
          return (
            <li key={link.href} className={cn(i > 0 && "border-t border-divider")}>
              <Link href={link.href} className={ROW}>
                <Icon className="h-[22px] w-[22px] shrink-0 text-themed-muted" aria-hidden="true" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-semibold">{link.label}</span>
                  {link.description && <span className="text-sm text-themed-muted">{link.description}</span>}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
        <li className="border-t border-divider">
          <button type="button" onClick={() => void signOut()} disabled={signingOut} className={cn(ROW, "disabled:opacity-60")}>
            <LogOut className="h-[22px] w-[22px] shrink-0 text-error" aria-hidden="true" />
            <span className="flex-1 text-base font-semibold text-error">{signingOut ? "Signing out…" : "Sign out"}</span>
          </button>
        </li>
      </ul>
      {error && (
        <p role="alert" className="mt-2 px-1 text-sm font-medium text-error">
          {error}
        </p>
      )}
    </nav>
  );
}
