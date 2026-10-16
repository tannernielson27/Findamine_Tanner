"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { popover, SPRING_SNAPPY } from "@/lib/motion";
import NotificationBell from "./notification-bell";
import SurveyNudge from "./survey-nudge";
import { Compass, Map, PlusCircle, Users, ShieldCheck, Settings, LogOut, Menu, X, Lock, Trophy, type LucideIcon } from "lucide-react";
import { navLinksFor, type NavIconKey } from "./nav-links";

const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  dashboard: Compass,
  browse: Map,
  leaderboard: Trophy,
  create: PlusCircle,
  rosters: Users,
  admin: ShieldCheck,
  privacy: Lock,
};

interface NavbarProps {
  user: {
    id: string;
    display_name: string | null;
    role: string;
    avatar_url: string | null;
    /** Assigned friction condition — only an explicit "high" removes Privacy from the main nav. */
    privacy_friction?: "low" | "high" | null;
    /** users.metadata, when the layout passes it — read only for the withdrawn flag. */
    metadata?: Record<string, unknown> | null;
  } | null;
}

export default function Navbar({ user }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  // Role gating and the privacy_friction rule live in nav-links.ts (unit tested).
  const navLinks = navLinksFor(user);

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-themed-border">
      <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 h-14">
        {/* Logo */}
        <Link href={user ? "/dashboard" : "/"} className="flex shrink-0 items-center gap-2 rounded-lg group">
          <Image
            src="/logo-findamine.png"
            alt="findamine"
            width={120}
            height={28}
            className="max-h-[28px] w-auto group-hover:opacity-80 transition-opacity"
            style={{ objectFit: "contain", height: "28px" }}
          />
        </Link>

        {/* Desktop nav: lg+ only; below that the creator/admin set collides with the account controls */}
        <nav aria-label="Main" className="hidden lg:flex min-w-0 items-center gap-1">
          {navLinks.map((link) => {
            const Icon = NAV_ICONS[link.icon];
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors ${
                  active
                    ? "text-brand-dark font-semibold"
                    : "text-themed-muted hover:bg-themed-bg hover:text-themed-text"
                }`}
              >
                {/* One shared pill that slides to the active link on navigation */}
                {active && (
                  <motion.span
                    layoutId="nav-active-pill"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-lg bg-brand-light"
                    transition={SPRING_SNAPPY}
                  />
                )}
                <Icon className="relative w-4 h-4" aria-hidden="true" />
                <span className="relative">{link.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Right side */}
        <div className="flex shrink-0 items-center gap-1">
          {user ? (
            <>
              <SurveyNudge />
              <NotificationBell />
              <Link
                href="/settings"
                aria-label="Settings"
                className="hidden lg:flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm text-themed-muted hover:bg-themed-bg hover:text-themed-text transition-colors"
              >
                {user.avatar_url ? (
                  <Image src={user.avatar_url} alt="" width={20} height={20} className="rounded-full" />
                ) : (
                  <div className="w-7 h-7 rounded-full bg-brand-light flex items-center justify-center">
                    <span className="text-xs font-bold text-brand-dark">
                      {(user.display_name || "?")[0].toUpperCase()}
                    </span>
                  </div>
                )}
                <span className="hidden lg:inline max-w-[120px] truncate">{user.display_name || "Profile"}</span>
              </Link>
              <button
                onClick={handleLogout}
                className="hidden lg:flex h-10 w-10 items-center justify-center rounded-lg text-themed-muted hover:text-themed-text hover:bg-themed-bg transition-colors"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Sign in
              </Link>
              <Link
                href="/register"
                className="flex min-h-11 items-center rounded-full bg-brand px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition-colors"
              >
                Sign up
              </Link>
            </>
          )}

          {/* Mobile hamburger */}
          {user && (
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="lg:hidden flex h-11 w-11 items-center justify-center rounded-lg text-themed-text hover:bg-themed-bg transition-colors"
              aria-label="Navigation menu"
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
      {menuOpen && user && (
        <motion.nav
          key="mobile-nav"
          aria-label="Main"
          variants={popover}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="lg:hidden origin-top border-t border-themed-border bg-white px-3 py-2 space-y-0.5"
        >
          {navLinks.map((link) => {
            const Icon = NAV_ICONS[link.icon];
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-base transition-colors ${
                  active
                    ? "bg-brand-light text-brand-dark font-semibold"
                    : "text-themed-text hover:bg-themed-bg"
                }`}
              >
                <Icon className="w-5 h-5" aria-hidden="true" />
                {link.label}
              </Link>
            );
          })}
          <hr className="my-1.5 border-themed-border" />
          <Link
            href="/settings"
            onClick={() => setMenuOpen(false)}
            className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-base text-themed-text hover:bg-themed-bg"
          >
            <Settings className="w-5 h-5" aria-hidden="true" />
            {user.display_name || "Profile"}
          </Link>
          <button
            onClick={() => { setMenuOpen(false); handleLogout(); }}
            className="flex min-h-11 items-center gap-2.5 w-full text-left rounded-lg px-3 text-base text-themed-muted hover:bg-themed-bg"
          >
            <LogOut className="w-5 h-5" aria-hidden="true" />
            Sign out
          </button>
          <div className="flex gap-4 px-3 pt-1.5 pb-1 text-xs text-themed-muted">
            <Link href="/privacy" onClick={() => setMenuOpen(false)} className="hover:underline">Privacy Policy</Link>
            <Link href="/terms" onClick={() => setMenuOpen(false)} className="hover:underline">Terms of Use</Link>
          </div>
        </motion.nav>
      )}
      </AnimatePresence>
    </header>
  );
}
