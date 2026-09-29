"use client";

import { useState, useEffect, useRef } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Medal, Star, Trophy } from "lucide-react";
import {
  summarizeViewerStanding,
  standingCaption,
  type ServerMe,
} from "@/lib/social/standing";

interface LeaderboardEntry {
  user_id: string;
  score: number;
  display_name: string | null;
  avatar_url: string | null;
  codename?: string | null;
  hunts_completed?: number;
}

interface LeaderboardProps {
  huntId?: string;
}

export default function Leaderboard({ huntId }: LeaderboardProps) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [identityMode, setIdentityMode] = useState("codename_assigned");
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [serverMe, setServerMe] = useState<ServerMe | null>(null);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function fetchLeaderboard() {
    const params = huntId ? `?hunt_id=${huntId}` : "";
    const res = await fetch(`/api/v1/leaderboard${params}`);
    if (res.ok) {
      const data = await res.json();
      setEntries(data.entries || []);
      if (data.identity_mode) setIdentityMode(data.identity_mode);
      setViewerId(data.viewer_id ?? null);
      setServerMe(data.me ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchLeaderboard();
  }, [huntId]);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    const filter = huntId ? `hunt_id=eq.${huntId}` : undefined;

    const channel = supabase
      .channel("leaderboard-updates")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "play_sessions",
          ...(filter ? { filter } : {}),
        },
        (payload) => {
          if (payload.new.status === "completed" || payload.new.total_score !== payload.old?.total_score) {
            if (refetchTimer.current) clearTimeout(refetchTimer.current);
            refetchTimer.current = setTimeout(() => {
              refetchTimer.current = null;
              fetchLeaderboard();
            }, 3000);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (refetchTimer.current) {
        clearTimeout(refetchTimer.current);
        refetchTimer.current = null;
      }
    };
  }, [huntId]);

  const medalTints = ["text-amber-500", "text-slate-400", "text-orange-700"];
  const podiumColors = [
    "from-amber-50 to-transparent",
    "from-slate-50 to-transparent",
    "from-orange-50 to-transparent",
  ];

  const { standing, pinned } = summarizeViewerStanding(entries, viewerId, serverMe);
  const caption = standingCaption(standing);

  return (
    <div className="rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="border-b border-themed-border px-4 py-3 flex items-center justify-between gap-3">
        <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text flex items-center gap-2 text-balance">
          <Trophy className="w-5 h-5 text-brand-dark" aria-hidden="true" />
          {huntId ? "Hunt Leaderboard" : "Leaderboard"}
        </h3>
        <span className="text-sm text-secondary flex items-center gap-1.5 font-medium">
          <span className="w-2 h-2 rounded-full bg-secondary motion-safe:animate-pulse" aria-hidden="true" />
          Live
        </span>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-9 h-9 rounded-full bg-themed-bg" />
              <div className="h-4 bg-themed-bg rounded-lg flex-1" />
              <div className="h-4 bg-themed-bg rounded-lg w-14" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="p-10 text-center">
          <Medal className="mx-auto mb-2 w-8 h-8 text-themed-muted" aria-hidden="true" />
          <p className="font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">No scores yet</p>
          <p className="font-[family-name:var(--font-handwritten)] text-lg text-themed-muted">Be the first explorer!</p>
        </div>
      ) : (
        <ol className="divide-y divide-themed-border">
          {entries.map((entry, i) => {
            const isViewer = viewerId != null && entry.user_id === viewerId;
            return (
              <li
                key={entry.user_id}
                className={`flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors ${
                  isViewer
                    ? "bg-brand-light/40 ring-1 ring-inset ring-brand/40"
                    : i < 3
                    ? `bg-gradient-to-r ${podiumColors[i]}`
                    : ""
                }`}
              >
                {/* Rank */}
                <div className="w-7 text-center shrink-0">
                  {i < 3 ? (
                    <>
                      <Medal className={`mx-auto w-6 h-6 ${medalTints[i]}`} aria-hidden="true" />
                      <span className="sr-only">Rank {i + 1}</span>
                    </>
                  ) : (
                    <span className="font-[family-name:var(--font-display)] text-base font-bold tabular-nums text-themed-muted">{i + 1}</span>
                  )}
                </div>

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-secondary/10 flex items-center justify-center shrink-0" aria-hidden="true">
                  <span className="font-[family-name:var(--font-display)] text-sm font-bold text-secondary">
                    {(entry.display_name || "?")[0].toUpperCase()}
                  </span>
                </div>

                {/* Name */}
                <div className="flex-1 min-w-0">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 truncate font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">
                      {entry.display_name || "Anonymous"}
                    </span>
                    {isViewer && (
                      <span className="shrink-0 rounded-full bg-brand-dark px-2 py-0.5 text-xs font-bold text-white">You</span>
                    )}
                  </p>
                  {isViewer && caption ? (
                    <p className="text-sm font-medium text-brand-dark">{caption}</p>
                  ) : entry.hunts_completed != null ? (
                    <p className="text-sm tabular-nums text-themed-muted">
                      {entry.hunts_completed} {entry.hunts_completed === 1 ? "hunt" : "hunts"}
                    </p>
                  ) : null}
                </div>

                {/* Score */}
                <div className="text-right shrink-0">
                  <span className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{entry.score}</span>
                  <span className="text-xs text-themed-muted ml-1">pts</span>
                </div>
              </li>
            );
          })}

          {/* Viewer's standing pinned when they're off the visible board */}
          {pinned && standing && (
            <li className="flex min-h-14 items-center gap-3 border-t-2 border-dashed border-brand/30 bg-brand-light/40 px-4 py-2.5">
              <div className="w-7 text-center shrink-0">
                <span className="font-[family-name:var(--font-display)] text-base font-bold tabular-nums text-brand-dark">{standing.rank}</span>
              </div>
              <div className="w-9 h-9 rounded-full bg-brand/10 flex items-center justify-center shrink-0" aria-hidden="true">
                <Star className="w-4 h-4 text-brand-dark" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">
                  You
                </p>
                {caption && <p className="text-sm font-medium text-brand-dark">{caption}</p>}
              </div>
              <div className="text-right shrink-0">
                <span className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{standing.score}</span>
                <span className="text-xs text-themed-muted ml-1">pts</span>
              </div>
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
