"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Award, Lock, Star } from "lucide-react";

interface BadgeProgress {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  icon_url: string | null;
  earned: boolean;
  earned_at: string | null;
}

export default function BadgesPage() {
  const [badges, setBadges] = useState<BadgeProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "earned" | "locked">("all");

  useEffect(() => {
    async function load() {
      const res = await fetch("/api/v1/gamification/badges/progress");
      if (res.ok) {
        const data = await res.json();
        setBadges(data.badges || []);
      }
      setLoading(false);
    }
    load();
  }, []);

  const earnedCount = badges.filter((b) => b.earned).length;

  const filtered = badges.filter((b) => {
    if (filter === "earned") return b.earned;
    if (filter === "locked") return !b.earned;
    return true;
  });

  const categories = [...new Set(filtered.map((b) => b.category))].sort();

  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-dark hover:underline">
        &larr; Dashboard
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text flex items-center gap-2 text-balance">
            <Award className="w-7 h-7 text-brand-dark" aria-hidden="true" />
            My Badges
          </h1>
          <p className="mt-1 text-base tabular-nums text-themed-muted">
            {earnedCount} of {badges.length} earned
          </p>
        </div>
        <div role="group" aria-label="Filter badges" className="flex rounded-lg border border-themed-border bg-surface text-sm overflow-hidden">
          {(["all", "earned", "locked"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`min-h-11 px-4 font-medium capitalize transition-colors ${
                filter === f
                  ? "bg-themed-text text-surface"
                  : "text-themed-muted hover:bg-themed-bg hover:text-themed-text"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(9)].map((_, i) => (
            <div key={i} className="h-24 bg-themed-bg border border-themed-border rounded-xl fm-shimmer" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-themed-border p-12 text-center">
          <Lock className="mx-auto mb-3 w-8 h-8 text-themed-muted" aria-hidden="true" />
          <p className="font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">
            {filter === "earned" ? "No badges earned yet" : "No badges to show"}
          </p>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-themed-muted mt-1">
            Keep exploring to unlock achievements!
          </p>
        </div>
      ) : (
        categories.map((category) => (
          <section key={category} className="mb-8">
            <h2 className="text-sm font-semibold text-themed-muted uppercase tracking-wider mb-3">
              {category.replace(/_/g, " ")}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered
                .filter((b) => b.category === category)
                .map((badge) => (
                  <div
                    key={badge.id}
                    className={`rounded-xl border p-4 ${
                      badge.earned
                        ? "border-themed-border bg-surface shadow-[var(--shadow-card)]"
                        : "border-dashed border-themed-border bg-themed-bg"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${
                        badge.earned ? "bg-brand-light text-brand-dark" : "bg-surface border border-themed-border text-themed-muted"
                      }`}>
                        {badge.icon_url ? (
                          <img src={badge.icon_url} alt="" width={32} height={32} loading="lazy" decoding="async" className={`w-8 h-8 ${badge.earned ? "" : "opacity-50 grayscale"}`} />
                        ) : badge.earned ? (
                          <Star className="w-6 h-6" aria-hidden="true" />
                        ) : (
                          <Lock className="w-5 h-5" aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`font-[family-name:var(--font-display)] text-base font-semibold ${badge.earned ? "text-themed-text" : "text-themed-muted"}`}>
                          {badge.name}
                        </p>
                        <p className="text-sm text-themed-muted mt-0.5">{badge.description}</p>
                        {badge.earned && badge.earned_at && (
                          <p className="text-sm text-secondary font-medium mt-1.5">
                            Earned {new Date(badge.earned_at).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))
      )}
    </main>
  );
}
