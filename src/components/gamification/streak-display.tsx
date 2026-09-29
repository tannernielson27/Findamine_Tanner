"use client";

import { useState, useEffect } from "react";
import { Flame } from "lucide-react";

interface StreakData {
  current_streak: number;
  longest_streak: number;
  last_activity: string | null;
}

export default function StreakDisplay() {
  const [data, setData] = useState<StreakData | null>(null);

  useEffect(() => {
    fetch("/api/v1/gamification/streak")
      .then((r) => { if (r.ok) return r.json(); throw new Error(); })
      // The route wraps the row: { streak: { current_streak, ... } }
      .then((d) => setData(d?.streak ?? null))
      .catch(() => {});
  }, []);

  if (!data || !(data.current_streak > 0)) return null;

  return (
    <div className="flex items-center gap-2 rounded-full border border-brand/20 bg-surface px-3 py-1.5">
      <Flame className="w-5 h-5 text-brand" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold text-themed-text">
          <span className="tabular-nums">{data.current_streak}</span>-day streak
        </p>
        {data.longest_streak > data.current_streak && (
          <p className="text-xs text-themed-muted">Best: {data.longest_streak} days</p>
        )}
      </div>
    </div>
  );
}
