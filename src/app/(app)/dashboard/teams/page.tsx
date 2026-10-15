"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import TeamChat from "@/components/social/team-chat";
import { NETWORK_ERROR_MESSAGE } from "@/app/login/auth-client";

interface Team {
  id: string;
  name: string;
  hunt_id: string;
  status: string;
  max_size: number;
  member_count: number;
  // Names arrive already filtered by each member's privacy settings (null = hidden).
  team_members: { user_id: string; role: string; users: { display_name: string | null } | null }[];
  hunt: { id: string; title: string | null; playable: boolean; team_mode: string } | null;
}

const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg";
const PRIMARY_LINK =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-dark";

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const [teamsRes, meRes] = await Promise.all([
        fetch("/api/v1/teams?mine=true", { cache: "no-store" }),
        fetch("/api/v1/auth/me"),
      ]);
      if (!teamsRes.ok) throw new Error(String(teamsRes.status));
      const data = await teamsRes.json();
      setTeams(data.teams || []);
      if (meRes.ok) {
        const me = await meRes.json();
        setCurrentUserId(me.user?.id || "");
      }
      setError("");
    } catch (err) {
      setError(err instanceof TypeError ? NETWORK_ERROR_MESSAGE : "We couldn't load your teams.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function retry() {
    setLoading(true);
    void load();
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-4">
      <Link
        href="/dashboard"
        className="mb-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-link transition-colors hover:text-link-dark hover:underline"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Dashboard
      </Link>
      <h1 className="mb-1 font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text">My Teams</h1>
      <p className="mb-6 text-base text-themed-muted">The teams you&apos;re on, one per team hunt.</p>

      {loading ? (
        <div className="animate-pulse space-y-3" aria-busy="true">
          <p className="sr-only" role="status">Loading your teams</p>
          {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-lg bg-themed-border" />)}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-themed-border bg-surface p-4">
          <p role="alert" className="mb-3 text-base text-[var(--color-error)]">{error}</p>
          <button type="button" onClick={retry} className={SECONDARY_BUTTON}>Try again</button>
        </div>
      ) : teams.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-themed-border p-8 text-center">
          <p className="text-base font-semibold text-themed-text">You&apos;re not on a team yet.</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-themed-muted">
            Open a team hunt to join or create a team. If your instructor assigns the teams, yours
            shows up here once they&apos;ve placed you.
          </p>
          <Link href="/browse" className={`${PRIMARY_LINK} mt-4`}>Browse hunts</Link>
        </div>
      ) : (
        <ul className="space-y-4">
          {teams.map((team) => {
            const chatOpen = activeChat === team.id;
            return (
              <li key={team.id} className="rounded-lg border border-themed-border bg-surface">
                <div className="p-4">
                  <h2 className="break-words text-lg font-semibold text-themed-text">{team.name}</h2>
                  <p className="text-sm text-themed-muted">
                    {team.hunt ? (
                      <>
                        Hunt:{" "}
                        <Link
                          href={`/browse/${team.hunt.id}`}
                          className="font-medium text-link underline hover:text-link-dark"
                        >
                          {team.hunt.title || "Untitled hunt"}
                        </Link>
                      </>
                    ) : (
                      "This hunt is no longer available."
                    )}
                  </p>
                  <p className="mt-2 text-sm tabular-nums text-themed-muted">
                    <Users className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
                    {team.member_count} of {team.max_size}:{" "}
                    {team.team_members
                      .map((m) => (m.user_id === currentUserId ? "You" : m.users?.display_name || "Explorer"))
                      .join(", ")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {team.hunt && (
                      <Link href={`/browse/${team.hunt.id}`} className={PRIMARY_LINK}>
                        {team.hunt.playable ? "Go to hunt" : "View hunt"}
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => setActiveChat(chatOpen ? null : team.id)}
                      aria-expanded={chatOpen}
                      className={SECONDARY_BUTTON}
                    >
                      {chatOpen ? "Close chat" : "Open chat"}
                    </button>
                  </div>
                </div>

                {chatOpen && currentUserId && (
                  <div className="border-t border-themed-border p-4">
                    <TeamChat teamId={team.id} currentUserId={currentUserId} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
