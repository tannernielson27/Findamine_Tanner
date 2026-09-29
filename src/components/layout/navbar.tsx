"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useState } from "react";
import NotificationBell from "./notification-bell";
import SurveyNudge from "./survey-nudge";
import { Compass, Map, PlusCircle, Users, ShieldCheck, Settings, LogOut, Menu, X, Lock } from "lucide-react";

interface NavbarProps {
  user: {
    id: string;
    display_name: string | null;
    role: string;
    avatar_url: string | null;
    /** Assigned friction condition — "low" surfaces Privacy in the main nav. */
    privacy_friction?: "low" | "high" | null;
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

  const isCreator = user && ["teacher", "hunt_creator", "admin", "researcher"].includes(user.role);
  const isAdmin = user && ["admin", "researcher"].includes(user.role);

  const navLinks = user
    ? [
        { href: "/dashboard", label: "Dashboard", icon: Compass },
        { href: "/browse", label: "Browse", icon: Map },
        ...(isCreator
          ? [
              { href: "/dashboard/hunts/new", label: "Create", icon: PlusCircle },
              { href: "/dashboard/rosters", label: "Rosters", icon: Users },
            ]
          : []),
        ...(isAdmin
          ? [{ href: "/admin", label: "Admin", icon: ShieldCheck }]
          : []),
        // LOW-friction condition: privacy is one prominent click from anywhere.
        // (High-friction participants reach it via Settings → More → Privacy.)
        ...(user.privacy_friction === "low"
          ? [{ href: "/settings/privacy", label: "Privacy", icon: Lock }]
          : []),
      ]
    : [];

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
            const Icon = link.icon;
            const active = pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm transition-colors ${
                  active
                    ? "bg-brand-light text-brand-dark font-semibold"
                    : "text-themed-muted hover:bg-themed-bg hover:text-themed-text"
                }`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" />
                {link.label}
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
              <Link href="/login" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-dark transition-colors"
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
      {menuOpen && user && (
        <nav aria-label="Main" className="lg:hidden border-t border-themed-border bg-white px-3 py-2 space-y-0.5">
          {navLinks.map((link) => {
            const Icon = link.icon;
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
        </nav>
      )}
    </header>
  );
}
