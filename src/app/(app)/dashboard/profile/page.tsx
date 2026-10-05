"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ChevronRight, Flame } from "lucide-react";

interface ProfileData {
  id: string;
  display_name: string | null;
  email: string;
  role: string;
  avatar_url: string | null;
  created_at: string;
  profile_visibility: Record<string, string>;
  metadata?: { real_name?: string | null };
}

/** The fields of GET /api/v1/gamification/me this page shows. */
interface Stats {
  hunts_completed: number;
  total_points: number;
  badges_earned: number;
  streak: { current_streak: number } | null;
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [realName, setRealName] = useState("");
  const [savedRealName, setSavedRealName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/me")
      .then((r) => r.json())
      .then((d) => {
        setProfile(d.user);
        const existing = d.user?.metadata?.real_name || "";
        setRealName(existing);
        setSavedRealName(existing);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Fetch stats
    fetch("/api/v1/gamification/me")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      .then((d) => setStats(d))
      .catch(() => {});
  }, []);

  async function handleSaveRealName() {
    setSavingName(true);
    const res = await fetch("/api/v1/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ real_name: realName }),
    });
    if (res.ok) setSavedRealName(realName.trim());
    setSavingName(false);
  }

  if (loading) return <main className="mx-auto max-w-2xl px-4 py-6"><p className="text-base text-themed-muted">Loading...</p></main>;
  if (!profile) return <main className="mx-auto max-w-2xl px-4 py-6"><p className="text-base text-themed-muted">Not found</p></main>;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {/* Profile header */}
      <header className="flex items-center gap-4 mb-6">
        <div
          className="w-16 h-16 shrink-0 rounded-full bg-secondary/10 flex items-center justify-center font-[family-name:var(--font-display)] text-2xl text-secondary font-bold"
          aria-hidden="true"
        >
          {profile.display_name?.[0]?.toUpperCase() || "?"}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text">{profile.display_name || "Explorer"}</h1>
          <p className="text-sm text-themed-muted">{profile.role} · joined {new Date(profile.created_at).toLocaleDateString()}</p>
          <Link href="/settings/privacy" className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-dark hover:underline">
            Privacy settings →
          </Link>
        </div>
      </header>

      {/* Stats grid */}
      <dl className="grid grid-cols-2 gap-2 mb-6 sm:grid-cols-4">
        <StatTile label="Hunts finished" value={stats?.hunts_completed || 0} />
        <StatTile label="Total points" value={stats?.total_points || 0} />
        <StatTile label="Badges" value={stats?.badges_earned || 0} />
        <StatTile
          label="Streak"
          value={stats?.streak?.current_streak || 0}
          icon={<Flame className="w-5 h-5 text-brand-dark" aria-hidden="true" />}
        />
      </dl>

      {/* Real name (optional — who can see it is controlled in Privacy Settings) */}
      <section className="rounded-xl border border-themed-border bg-surface p-4 mb-6 shadow-[var(--shadow-card)]">
        <label htmlFor="realName" className="block font-[family-name:var(--font-display)] text-base font-semibold text-themed-text mb-1">
          Real name <span className="font-[family-name:var(--font-body)] text-sm font-normal text-themed-muted">(optional)</span>
        </label>
        <p className="text-sm text-themed-muted mb-3">
          Shown to others only if you allow it in{" "}
          <Link href="/settings/privacy" className="font-medium text-link hover:text-link-dark underline">
            privacy settings
          </Link>
          .
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            id="realName"
            type="text"
            value={realName}
            onChange={(e) => setRealName(e.target.value)}
            maxLength={120}
            placeholder="First and last name"
            className="min-h-11 min-w-0 flex-1 basis-48 rounded-lg border border-themed-border bg-themed-bg px-3 py-2 text-base text-themed-text focus:bg-surface focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <button
            onClick={handleSaveRealName}
            disabled={savingName || realName.trim() === savedRealName}
            className="min-h-11 shrink-0 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-40"
          >
            {savingName ? "Saving..." : "Save"}
          </button>
        </div>
      </section>

      {/* Quick links */}
      <nav aria-label="Profile shortcuts" className="space-y-2">
        <QuickLink href={`/profile/${profile.id}`} title="Your player page" description="The page other players open, limited by your privacy settings" />
        <QuickLink href="/leaderboard" title="Leaderboard" description="Ranked by hunt score from finished hunts" />
        <QuickLink href="/dashboard/assessment" title="Personality Assessment" description="Big 5 + Growth Mindset" />
        <QuickLink href="/dashboard/badges" title="My Badges" description="View achievements" />
        <QuickLink href="/settings" title="Account Settings" description="Name, email, password" />
        <QuickLink href="/settings/privacy" title="Privacy Settings" description="Control who sees your information" />
      </nav>
    </main>
  );
}

function StatTile({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col-reverse rounded-xl border border-themed-border bg-surface px-3 py-2.5 text-center">
      <dt className="text-sm text-themed-muted">{label}</dt>
      <dd className="flex items-center justify-center gap-1 font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-themed-text">
        {value}
        {icon}
      </dd>
    </div>
  );
}

function QuickLink({ href, title, description }: { href: string; title: string; description: string }) {
  return (
    <Link
      href={href}
      className="group flex min-h-14 items-center justify-between gap-3 rounded-xl border border-themed-border bg-surface px-4 py-3 transition-colors hover:border-secondary/40 hover:bg-themed-bg"
    >
      <span className="min-w-0">
        <span className="block font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">{title}</span>
        <span className="block text-sm text-themed-muted">{description}</span>
      </span>
      <ChevronRight className="w-5 h-5 shrink-0 text-themed-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
