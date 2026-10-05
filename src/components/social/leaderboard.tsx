"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Medal, Star, Trophy } from "lucide-react";
import {
  competitionRanks,
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
  /** Set by the API only when the row already shows the player's own name. */
  profile_linkable?: boolean;
}

interface LeaderboardProps {
  huntId?: string;
}

interface Board {
  entries: LeaderboardEntry[];
  viewerId: string | null;
  me: ServerMe | null;
}

/** One fetch of the board; null when the request fails (keep what's on screen). */
async function loadBoard(huntId: string | undefined): Promise<Board | null> {
  try {
    const params = huntId ? `?hunt_id=${encodeURIComponent(huntId)}` : "";
    const res = await fetch(`/api/v1/leaderboard${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { entries: data.entries || [], viewerId: data.viewer_id ?? null, me: data.me ?? null };
  } catch {
    return null;
  }
}

export default function Leaderboard({ huntId }: LeaderboardProps) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadBoard(huntId).then((next) => {
      if (cancelled) return;
      if (next) setBoard(next);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
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
              loadBoard(huntId).then((next) => {
                if (next) setBoard(next);
              });
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

  const entries = board?.entries ?? [];
  const viewerId = board?.viewerId ?? null;
  const ranks = competitionRanks(entries);
  const { standing, pinned } = summarizeViewerStanding(entries, viewerId, board?.me);
  const caption = standingCaption(standing);
  // Signed in, board has scores, but none of them are the viewer's.
  const unranked = viewerId != null && !standing && entries.length > 0;

  return (
    <div className="rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)] overflow-hidden">
      <div className="border-b border-themed-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text flex items-center gap-2 text-balance">
            <Trophy className="w-5 h-5 text-brand-dark" aria-hidden="true" />
            {huntId ? "Hunt Leaderboard" : "Leaderboard"}
          </h3>
          <span className="text-sm text-secondary flex items-center gap-1.5 font-medium">
            <span className="w-2 h-2 rounded-full bg-secondary motion-safe:animate-pulse" aria-hidden="true" />
            Live
          </span>
        </div>
        {!huntId && (
          <p className="mt-1 text-sm text-themed-muted">
            Ranked by hunt score: points from hunts you&apos;ve finished. Bonuses and hunts still
            in progress count toward the total points on your profile, not here.
          </p>
        )}
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
            const rank = ranks[i];
            const name = entry.display_name || "Anonymous";
            return (
              <li
                key={entry.user_id}
                className={`flex min-h-14 items-center gap-3 px-4 py-2.5 transition-colors ${
                  isViewer
                    ? "bg-brand-light/40 ring-1 ring-inset ring-brand/40"
                    : rank <= 3
                    ? `bg-gradient-to-r ${podiumColors[rank - 1]}`
                    : ""
                }`}
              >
                {/* Rank */}
                <div className="w-7 text-center shrink-0">
                  {rank <= 3 ? (
                    <>
                      <Medal className={`mx-auto w-6 h-6 ${medalTints[rank - 1]}`} aria-hidden="true" />
                      <span className="sr-only">Rank {rank}</span>
                    </>
                  ) : (
                    <span className="font-[family-name:var(--font-display)] text-base font-bold tabular-nums text-themed-muted">{rank}</span>
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
                    {entry.profile_linkable && !isViewer ? (
                      <Link
                        href={`/profile/${entry.user_id}`}
                        className="min-w-0 truncate font-[family-name:var(--font-display)] text-base font-semibold text-themed-text underline-offset-2 hover:text-link hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate font-[family-name:var(--font-display)] text-base font-semibold text-themed-text">
                        {name}
                      </span>
                    )}
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

          {/* Signed in but not ranked: say why, and what gets you on the board */}
          {unranked && (
            <li className="flex min-h-14 flex-wrap items-center justify-between gap-2 border-t-2 border-dashed border-brand/30 bg-brand-light/40 px-4 py-2.5">
              <p className="text-sm font-medium text-themed-text">
                {huntId
                  ? "You're not on this board yet. Finish this hunt to get on it."
                  : "You're not on the board yet. Finish a hunt to get on it."}
              </p>
              {!huntId && (
                <Link href="/browse" className="inline-flex min-h-11 items-center text-sm font-semibold text-link hover:text-link-dark hover:underline">
                  Browse hunts &rarr;
                </Link>
              )}
            </li>
          )}
        </ol>
      )}
    </div>
  );
}
