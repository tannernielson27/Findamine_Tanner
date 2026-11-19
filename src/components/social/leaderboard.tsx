"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Medal, Star, Trophy } from "lucide-react";
import { LazyMotion, m } from "framer-motion";
import { SPRING_SNAPPY } from "@/lib/motion";
import {
  competitionRanks,
  summarizeViewerStanding,
  standingCaption,
  type ServerMe,
} from "@/lib/social/standing";
import { leaderboardTopic } from "@/lib/social/leaderboard-channel";
import { useLiveBoard } from "@/lib/social/use-live-board";
import {
  boardRequestPath,
  otherPlayersNote,
  realNameLabel,
  type RealNameStatus,
} from "@/lib/social/real-names";

interface LeaderboardEntry {
  user_id: string;
  score: number;
  display_name: string | null;
  avatar_url: string | null;
  codename?: string | null;
  hunts_completed?: number;
  /** Set by the API only when the row already shows the player's own name. */
  profile_linkable?: boolean;
  /** Real-name fields: sent only to an allowed viewer who switched real names on. */
  real_name?: string | null;
  real_name_status?: RealNameStatus;
  shown_as?: string | null;
}

interface LeaderboardProps {
  huntId?: string;
  /**
   * Offer the "Show real names" switch. For admins and researchers only
   * (canViewRealNames). It only decides whether the switch is drawn: the API
   * checks again and sends real names to nobody else.
   */
  canShowRealNames?: boolean;
}

interface Board {
  entries: LeaderboardEntry[];
  viewerId: string | null;
  me: ServerMe | null;
  /** This fetch asked for real names. */
  askedRealNames: boolean;
  /** The API sent them (it does so only for an allowed viewer). */
  realNames: boolean;
}

/**
 * Give up on a board request after this long. A request left hanging (the
 * app was suspended mid-flight, a dead connection) would otherwise hold up
 * every later refetch, because refetches never overlap.
 */
const BOARD_FETCH_TIMEOUT_MS = 10_000;

/** One fetch of the board; null when the request fails (keep what's on screen). */
async function loadBoard(huntId: string | undefined, realNames: boolean): Promise<Board | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BOARD_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(boardRequestPath(huntId, realNames), {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      entries: data.entries || [],
      viewerId: data.viewer_id ?? null,
      me: data.me ?? null,
      askedRealNames: realNames,
      realNames: data.real_names === true,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const loadLayoutFeatures = () => import("@/lib/themes/motion-features-max").then((mod) => mod.default);

export default function Leaderboard({ huntId, canShowRealNames = false }: LeaderboardProps) {
  const topic = leaderboardTopic(huntId);
  // Real names (issue #13) are off every time a board is opened and are never
  // remembered: the switch is held for the board it was turned on for, so a
  // different board, a reload or coming back to the page starts with them off.
  const [realNamesFor, setRealNamesFor] = useState<string | null>(null);
  // Showing a different board: forget the switch, so coming back to the first
  // board later does not bring real names back without a click.
  if (realNamesFor !== null && realNamesFor !== topic) setRealNamesFor(null);
  const realNamesOn = canShowRealNames && realNamesFor === topic;
  const realNamesSwitch = useRef<HTMLButtonElement>(null);

  // Live updates: the server pings this board's own channel when standings
  // change and the board refetches from the API; a poll covers missed pings.
  // No player data travels over the channel (see lib/social/leaderboard-channel).
  const load = useCallback(() => loadBoard(huntId, realNamesOn), [huntId, realNamesOn]);
  const { data: board, loading } = useLiveBoard(topic, load);

  // Drawn only while the switch is on AND the board on screen came with real
  // names, so switching off hides them at once, before the refetch lands.
  const showingRealNames = realNamesOn && board?.realNames === true;
  const realNamesRefused = realNamesOn && board?.askedRealNames === true && !board.realNames;

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
    <LazyMotion features={loadLayoutFeatures}>
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
        {canShowRealNames && (
          <button
            ref={realNamesSwitch}
            type="button"
            role="switch"
            aria-checked={realNamesOn}
            onClick={() => setRealNamesFor(realNamesOn ? null : topic)}
            className="mt-2 -ml-1 inline-flex min-h-11 items-center gap-2.5 rounded-lg px-1 text-sm font-semibold text-themed-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <span
              aria-hidden="true"
              className={`flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                realNamesOn ? "bg-warning" : "bg-themed-border"
              }`}
            >
              <span
                className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  realNamesOn ? "translate-x-4" : ""
                }`}
              />
            </span>
            Show real names
            <span className="font-normal text-themed-muted">Only on your screen</span>
          </button>
        )}
      </div>

      {/* Stays on screen for as long as real names are switched on. The status
          region itself is always there (empty while off) so that screen
          readers announce it when the notice appears. */}
      {canShowRealNames && (
        <div
          role="status"
          className={
            realNamesOn
              ? "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b-2 border-warning bg-warning/15 px-4 py-2.5"
              : undefined
          }
        >
          {realNamesOn && (
            <>
              <p className="flex min-w-0 flex-1 basis-56 items-start gap-2 text-sm text-themed-text">
                <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {showingRealNames ? (
                  <span>
                    <strong>Real names are showing.</strong> Only you see them; other players&apos;
                    boards have not changed. Turn this off before you share or project your screen.
                  </span>
                ) : realNamesRefused ? (
                  <span>
                    <strong>Real names are not available</strong> to you on this board.
                  </span>
                ) : (
                  <span>Loading real names&hellip;</span>
                )}
              </p>
              <button
                type="button"
                onClick={() => {
                  setRealNamesFor(null);
                  // This button is about to go: hand focus back to the switch.
                  realNamesSwitch.current?.focus();
                }}
                className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-themed-text underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                Hide real names
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="p-4 space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-3 fm-shimmer">
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
            const playersSee = showingRealNames ? otherPlayersNote(name, entry.shown_as) : null;
            return (
              // layout="position": when a live update reorders the board, rows
              // slide to their new rank instead of jumping.
              <m.li
                key={entry.user_id}
                layout="position"
                transition={SPRING_SNAPPY}
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
                  {/* Real name next to the name the board shows, so an admin
                      can tell who is who. */}
                  {showingRealNames && (
                    <p className="text-sm text-themed-text [overflow-wrap:anywhere]">
                      <span className="font-semibold">Real name:</span>{" "}
                      <span className={entry.real_name ? undefined : "italic text-themed-muted"}>
                        {realNameLabel(entry)}
                      </span>
                    </p>
                  )}
                  {playersSee && (
                    <p className="text-sm text-themed-muted [overflow-wrap:anywhere]">{playersSee}</p>
                  )}
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
              </m.li>
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
    </LazyMotion>
  );
}
