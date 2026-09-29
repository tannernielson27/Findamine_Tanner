"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { TrendingUp } from "lucide-react";

interface FeaturedHunt {
  hunt_id: string;
  feature_type: string;
  curator_comment: string | null;
  hunts: { title: string; description: string; target_audience: string; estimated_duration_min: number | null } | null;
}

export default function FeaturedHunts() {
  const [featured, setFeatured] = useState<FeaturedHunt[]>([]);

  useEffect(() => {
    fetch("/api/v1/curriculum?type=tasks&limit=1") // Placeholder — will use featured_hunts table
      .catch(() => {});
    // For now, show top-rated hunts as "featured"
    fetch("/api/v1/analytics/insights")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      .then((d) => {
        if (d.top_by_plays?.length > 0) {
          setFeatured(d.top_by_plays.slice(0, 3).map((h: { hunt_id: string; title: string; plays: number; avg_score: number }) => ({
            hunt_id: h.hunt_id,
            feature_type: "trending",
            curator_comment: `${h.plays} plays · avg ${h.avg_score} pts`,
            hunts: { title: h.title, description: "", target_audience: "", estimated_duration_min: null },
          })));
        }
      })
      .catch(() => {});
  }, []);

  if (featured.length === 0) return null;

  return (
    <section aria-labelledby="featured-heading">
      <h2 id="featured-heading" className="mb-2 text-sm font-semibold text-themed-muted">Featured hunts</h2>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 [overscroll-behavior-x:contain]">
        {featured.map((f) => (
          <Link
            key={f.hunt_id}
            href={`/browse/${f.hunt_id}`}
            className="w-60 shrink-0 rounded-xl border border-themed-border bg-surface px-4 py-3 transition-colors hover:border-brand/40"
          >
            <span className="inline-flex items-center gap-1 text-xs font-semibold capitalize text-brand-dark">
              <TrendingUp className="w-3.5 h-3.5" aria-hidden="true" />
              {f.feature_type}
            </span>
            <p className="mt-1 truncate font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">{f.hunts?.title}</p>
            {f.curator_comment && (
              <p className="mt-0.5 text-sm tabular-nums text-themed-muted">{f.curator_comment}</p>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
