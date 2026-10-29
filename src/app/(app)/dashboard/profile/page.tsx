"use client";

import { useState, useEffect } from "react";
import { fetchMe, invalidateMe } from "@/lib/hooks/use-me";
import Link from "next/link";
import { Award, Brain, ChevronRight, CircleUserRound, Trophy, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatRow } from "@/components/ui/progress";
import { initialsOf } from "@/components/home/home-data";
import { BadgeShelf } from "./badge-shelf";
import { SettingsList } from "./settings-list";
import { profileSubtitle } from "./profile-format";
import type { PrivacyFriction } from "@/components/layout/nav-links";

interface ProfileData {
  id: string;
  display_name: string | null;
  email: string;
  role: string;
  avatar_url: string | null;
  created_at: string;
  profile_visibility: Record<string, string>;
  metadata?: { real_name?: string | null; privacy_friction?: string | null } & Record<string, unknown>;
}

/** The assigned friction level, if it is one the nav rules know. */
function frictionOf(metadata: ProfileData["metadata"]): PrivacyFriction {
  const f = metadata?.privacy_friction;
  return f === "low" || f === "high" ? f : null;
}

/** The fields of GET /api/v1/gamification/me this page shows. */
interface Stats {
  hunts_completed: number;
  total_points: number;
  badges_earned: number;
  streak: { current_streak: number } | null;
}

/**
 * Profile tab: stats header, badge shelf, real-name editing (unchanged
 * behaviour), "you" links, then the settings list that replaced the old
 * hamburger menu.
 */
export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [realName, setRealName] = useState("");
  const [savedRealName, setSavedRealName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    fetchMe()
      .then((d) => {
        if (!d) throw new Error("me unavailable");
        setProfile(d.user as unknown as ProfileData);
        const existing = (d.user?.metadata?.real_name as string | undefined) || "";
        setRealName(existing);
        setSavedRealName(existing);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/v1/gamification/me")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      .then((d) => setStats(d))
      .catch(() => {});
  }, []);

  async function handleSaveRealName() {
    setSavingName(true);
    setNameError("");
    try {
      const res = await fetch("/api/v1/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ real_name: realName }),
      });
      if (res.ok) {
        invalidateMe();
        setSavedRealName(realName.trim());
      }
      else setNameError("Couldn't save your name. Try again.");
    } catch {
      setNameError("Couldn't save your name. Try again.");
    }
    setSavingName(false);
  }

  if (loading) return <ProfileSkeleton />;
  if (!profile) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <p className="text-base text-themed-muted">We couldn&apos;t load your profile. Try again in a moment.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-4 pt-6">
      {/* Stats header */}
      <header className="flex items-center gap-4">
        <div
          className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-juniper-tint font-[family-name:var(--font-display)] text-[26px] font-semibold text-juniper"
          aria-hidden="true"
        >
          {initialsOf(profile.display_name)}
        </div>
        <div className="min-w-0">
          <h1 className="m-0 truncate font-[family-name:var(--font-display)] text-[30px] font-semibold leading-tight text-themed-text">
            {profile.display_name || "Explorer"}
          </h1>
          <p className="m-0 text-[15px] text-themed-muted">
            {profileSubtitle(profile.role, profile.created_at)}
          </p>
        </div>
      </header>

      <StatRow
        className="mt-5"
        items={[
          { value: String(stats?.total_points ?? 0), label: "Points" },
          { value: String(stats?.badges_earned ?? 0), label: "Badges" },
          { value: String(stats?.hunts_completed ?? 0), label: "Hunts" },
          { value: String(stats?.streak?.current_streak ?? 0), label: "Streak" },
        ]}
      />

      <BadgeShelf />

      {/* Real name (optional). Who can see it is set in privacy settings
          (the Privacy settings row below, or Settings → More for high
          friction: see showPrivacyProfileRow in components/layout/nav-links.ts). */}
      <section className="mt-7 rounded-card border border-themed-border bg-surface p-4">
        <label htmlFor="realName" className="mb-1 block font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text">
          Real name <span className="font-[family-name:var(--font-body)] text-sm font-normal text-themed-muted">(optional)</span>
        </label>
        <p className="mb-3 text-sm text-themed-muted">Shown to others only if you allow it in your privacy settings.</p>
        <div className="flex flex-wrap gap-2">
          <input
            id="realName"
            type="text"
            value={realName}
            onChange={(e) => setRealName(e.target.value)}
            maxLength={120}
            placeholder="First and last name"
            className="min-h-12 min-w-0 flex-1 basis-48 rounded-[14px] border border-themed-border bg-themed-bg px-3 py-2 text-base text-themed-text focus:border-brand focus:bg-surface focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <Button onClick={handleSaveRealName} disabled={savingName || realName.trim() === savedRealName}>
            {savingName ? "Saving…" : "Save"}
          </Button>
        </div>
        {nameError && (
          <p role="alert" className="mt-2 text-sm font-medium text-error">
            {nameError}
          </p>
        )}
      </section>

      {/* You */}
      <nav aria-label="Your pages" className="mt-7">
        <ul className="m-0 list-none overflow-hidden rounded-card border border-themed-border bg-surface p-0">
          <YouLink href={`/profile/${profile.id}`} icon={CircleUserRound} title="Your player page" description="What other players see, limited by your privacy settings" first />
          <YouLink href="/dashboard/badges" icon={Award} title="Badges" description="Everything you've earned and what's next" />
          <YouLink href="/leaderboard" icon={Trophy} title="Leaderboard" description="Ranked by hunt score from finished hunts" />
          <YouLink href="/dashboard/assessment" icon={Brain} title="Personality assessment" description="Big 5 + Growth Mindset" />
        </ul>
      </nav>

      <SettingsList
        role={profile.role}
        user={{ privacy_friction: frictionOf(profile.metadata), metadata: profile.metadata ?? null }}
      />
    </main>
  );
}

interface YouLinkProps {
  href: string;
  icon: LucideIcon;
  title: string;
  description: string;
  first?: boolean;
}

/** Same row layout as SettingsList (icon, 14px gap) so the two lists' text columns line up. */
function YouLink({ href, icon: Icon, title, description, first = false }: YouLinkProps) {
  return (
    <li className={first ? undefined : "border-t border-divider"}>
      <Link
        href={href}
        className="flex min-h-[68px] items-center gap-3.5 px-4 py-3 text-themed-text no-underline transition-colors duration-150 hover:bg-themed-bg"
      >
        <Icon className="h-[22px] w-[22px] shrink-0 text-themed-muted" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-base font-semibold">{title}</span>
          <span className="text-sm text-themed-muted">{description}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
      </Link>
    </li>
  );
}

function ProfileSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-4 pt-6" aria-busy="true" aria-label="Loading profile">
      <div className="fm-shimmer" aria-hidden="true">
        <div className="flex items-center gap-4">
          <div className="h-[72px] w-[72px] shrink-0 rounded-full bg-divider" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-8 w-1/2 rounded-md bg-divider" />
            <div className="h-4 w-1/3 rounded-md bg-divider" />
          </div>
        </div>
        <div className="mt-5 h-[76px] rounded-[18px] bg-divider" />
        <div className="mt-7 h-7 w-28 rounded-md bg-divider" />
        <div className="mt-3 flex gap-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 w-16 rounded-full bg-divider" />
          ))}
        </div>
        <div className="mt-7 h-64 rounded-card bg-divider" />
      </div>
    </main>
  );
}
