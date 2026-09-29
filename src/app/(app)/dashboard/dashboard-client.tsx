"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import InsightsPanel from "@/components/hunts/insights-panel";
import StreakDisplay from "@/components/gamification/streak-display";
import FeaturedHunts from "@/components/gamification/featured-hunts";
import { Map, Users, Award, Heart, Compass, ChevronRight, MapPin } from "lucide-react";

interface DashboardUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  avatar_url: string | null;
  created_at: string;
}

const GREETINGS = [
  "Ready for an adventure",
  "Welcome back, explorer",
  "Time to discover something new",
  "Your next adventure awaits",
  "The trail is calling",
];

export default function DashboardClient({ user }: { user: DashboardUser }) {
  const [counts, setCounts] = useState({ hunts: 0, teams: 0, badges: 0 });
  // Rotate by day, not Math.random: a random pick differs between the server
  // render and hydration.
  const greeting = GREETINGS[new Date().getDate() % GREETINGS.length];

  useEffect(() => {
    async function loadCounts() {
      try {
        const [huntsRes, badgesRes] = await Promise.all([
          fetch("/api/v1/hunts?mine=true"),
          fetch("/api/v1/badges?mine=true"),
        ]);
        const huntsData = huntsRes.ok ? await huntsRes.json() : { hunts: [] };
        const badgesData = badgesRes.ok ? await badgesRes.json() : { badges: [] };

        setCounts({
          hunts: (huntsData.hunts || []).length,
          teams: 0,
          badges: (badgesData.badges || []).length,
        });
      } catch {
        // Keep defaults on error
      }
    }
    loadCounts();
  }, []);

  return (
    <main>
      {/* Welcome header: the screen's one topo band */}
      <header className="fm-topo border-b border-themed-border">
        <div className="mx-auto flex max-w-4xl flex-wrap items-end justify-between gap-3 px-4 pt-8 pb-6">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text text-balance">
              {user.display_name ? `Hey, ${user.display_name}!` : "Hey there!"}
            </h1>
            <p className="font-[family-name:var(--font-handwritten)] text-xl text-brand-dark mt-1">
              {greeting} <Compass className="w-4 h-4 inline" aria-hidden="true" />
            </p>
          </div>
          <StreakDisplay />
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-4 py-6 space-y-8">
        {/* Primary action */}
        <section
          aria-labelledby="next-hunt-heading"
          className="flex flex-col gap-4 rounded-xl border border-themed-border bg-surface p-5 shadow-[var(--shadow-card)] sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <h2 id="next-hunt-heading" className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text">
              Find your next hunt
            </h2>
            <p className="mt-1 text-base text-themed-muted">
              Pick a trail nearby, follow the clues, and score points at every stop.
            </p>
          </div>
          <Link
            href="/browse"
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark"
          >
            <MapPin className="w-5 h-5" aria-hidden="true" />
            Browse hunts
          </Link>
        </section>

        {/* Featured hunts */}
        <FeaturedHunts />

        {/* Shortcuts */}
        <nav aria-label="Your stuff" className="grid gap-3 sm:grid-cols-2">
          <DashboardCard title="My Hunts" description="Create and manage hunts" count={counts.hunts} href="/dashboard/hunts" icon={Map} />
          <DashboardCard title="My Teams" description="View your teams" count={counts.teams} href="/dashboard/teams" icon={Users} />
          <DashboardCard title="Badges" description="Achievements earned" count={counts.badges} href="/dashboard/badges" icon={Award} />
          <DashboardCard title="Social" description="Friends and kudos" count={0} href="/dashboard/social" icon={Heart} />
        </nav>

        {/* Hunt creator insights */}
        {["teacher", "hunt_creator", "admin", "researcher"].includes(user.role) && <InsightsPanel />}
      </div>
    </main>
  );
}

function DashboardCard({
  title,
  description,
  count,
  href,
  icon: Icon,
}: {
  title: string;
  description: string;
  count: number;
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-16 items-center gap-4 rounded-xl border border-themed-border bg-surface px-4 py-3 transition-colors hover:border-secondary/40 hover:bg-themed-bg"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-secondary/10 text-secondary">
        <Icon className="w-5 h-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">
          {title}
        </span>
        <span className="block text-sm text-themed-muted">{description}</span>
      </span>
      {count > 0 && (
        <span className="font-[family-name:var(--font-display)] text-xl font-bold tabular-nums text-themed-text">
          {count}
        </span>
      )}
      <ChevronRight className="w-5 h-5 shrink-0 text-themed-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}
