"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Play, Users } from "lucide-react";
import { NETWORK_ERROR_MESSAGE, postJson } from "@/app/login/auth-client";

/**
 * Team step of a team-mode hunt's detail page: shows the player's team (or
 * lets them join / create one when the hunt allows it) and only offers
 * "Start hunt" once they are on a team.
 *
 * Member names come from GET /api/v1/teams, which has already applied each
 * member's privacy settings for this viewer; a hidden name arrives as null
 * and is shown as "Explorer". Nothing here reads visibility settings.
 */

interface TeamMember {
  user_id: string;
  role: string;
  users: { id: string; display_name: string | null } | null;
}

interface Team {
  id: string;
  name: string;
  status: string;
  max_size: number;
  member_count: number;
  is_full: boolean;
  team_members: TeamMember[];
}

interface TeamsResponse {
  teams: Team[];
  hunt: { id: string; team_mode: "solo" | "self_select" | "assigned"; playable: boolean; max_team_size: number };
  viewer: { id: string; team_id: string | null; can_manage: boolean };
}

type LoadState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "error"; message: string }
  | { status: "ready"; data: TeamsResponse };

const JOINABLE_STATUSES = ["forming", "ready"];
const TEAM_NAME_MAX = 40;

const PRIMARY_LINK =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-6 text-base font-semibold text-white transition-colors hover:bg-brand-dark sm:w-auto";
/** Same footprint as PRIMARY_LINK, outlined, for when the sticky bar already carries the primary action. */
const SECONDARY_LINK =
  "inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-6 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg sm:w-auto";
const PRIMARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";
const SECONDARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg disabled:opacity-50";
const PANEL = "rounded-lg border border-themed-border bg-surface p-4";
const HEADING = "font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text";

function memberNames(team: Team, viewerId: string): string {
  if (team.team_members.length === 0) return "No members yet";
  return team.team_members
    .map((m) => (m.user_id === viewerId ? "You" : m.users?.display_name || "Explorer"))
    .join(", ");
}

function TeamSummary({ team, viewerId }: { team: Team; viewerId: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-base font-semibold text-themed-text">{team.name}</p>
      <p className="text-sm tabular-nums text-themed-muted">
        <Users className="mr-1 inline h-4 w-4 align-text-bottom" aria-hidden="true" />
        {team.member_count} of {team.max_size} {team.max_size === 1 ? "spot" : "spots"} filled
      </p>
      <p className="mt-0.5 break-words text-sm text-themed-muted">{memberNames(team, viewerId)}</p>
    </div>
  );
}

export default function HuntTeamPanel({ huntId, playHref }: { huntId: string; playHref: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  /** Which action is in flight: "join:<id>", "leave:<id>" or "create". */
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  const [teamName, setTeamName] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/teams?hunt_id=${encodeURIComponent(huntId)}`, { cache: "no-store" });
      if (res.status === 401) return setState({ status: "signed_out" });
      if (!res.ok) throw new Error(String(res.status));
      setState({ status: "ready", data: (await res.json()) as TeamsResponse });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof TypeError ? NETWORK_ERROR_MESSAGE : "We couldn't load the teams for this hunt.",
      });
    }
  }, [huntId]);

  useEffect(() => {
    void load();
  }, [load]);

  function retry() {
    setState({ status: "loading" });
    void load();
  }

  /** Run one team action, then refresh so counts and membership are current either way. */
  async function act(key: string, url: string, body: unknown, fallback: string): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setActionError("");
    const result = await postJson(url, body, fallback);
    await load();
    setBusy(null);
    setConfirmLeave(false);
    if (!result.ok) setActionError(result.error);
    return result.ok;
  }

  const join = (team: Team) =>
    act(`join:${team.id}`, `/api/v1/teams/${team.id}/join`, {}, "Couldn't join that team. Please try again.");
  const leave = (team: Team) =>
    act(`leave:${team.id}`, `/api/v1/teams/${team.id}/leave`, {}, "Couldn't leave the team. Please try again.");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const name = teamName.trim();
    if (!name) return;
    const ok = await act("create", "/api/v1/teams", { hunt_id: huntId, name }, "Couldn't create the team. Please try again.");
    if (ok) setTeamName("");
  }

  if (state.status === "loading") {
    return (
      <div className={PANEL} aria-busy="true">
        <p className="sr-only" role="status">Loading teams</p>
        <div className="fm-shimmer space-y-3">
          <div className="h-5 w-1/3 rounded bg-themed-border" />
          <div className="h-14 rounded-lg bg-themed-border" />
          <div className="h-11 rounded-lg bg-themed-border" />
        </div>
      </div>
    );
  }

  if (state.status === "signed_out") {
    return (
      <div className={PANEL}>
        <p className="mb-3 text-base text-themed-text">This hunt is played in teams. Sign in to see your team.</p>
        <Link href="/login" className={PRIMARY_LINK}>Sign in</Link>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className={PANEL}>
        <p role="alert" className="mb-3 text-base text-[var(--color-error)]">{state.message}</p>
        <button type="button" onClick={retry} className={SECONDARY_BUTTON}>Try again</button>
      </div>
    );
  }

  const { teams, hunt, viewer } = state.data;
  const selfSelect = hunt.team_mode === "self_select";
  const myTeam = teams.find((t) => t.id === viewer.team_id) ?? null;
  const otherTeams = teams.filter((t) => t.id !== myTeam?.id);
  const error = actionError && (
    <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-error)]">{actionError}</p>
  );

  const startLink = (label: string, className = PRIMARY_LINK) => (
    <Link href={playHref} className={className}>
      <Play className="h-5 w-5" aria-hidden="true" />
      {label}
    </Link>
  );

  return (
    <section aria-labelledby="hunt-team-heading" className={PANEL}>
      <h2 id="hunt-team-heading" className={`${HEADING} mb-2`}>
        {myTeam ? "Your team" : selfSelect ? "Pick a team to start" : "Your team"}
      </h2>

      {myTeam ? (
        <>
          <TeamSummary team={myTeam} viewerId={viewer.id} />
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {startLink("Start hunt")}
            {selfSelect &&
              (confirmLeave ? (
                <>
                  <button
                    type="button"
                    onClick={() => leave(myTeam)}
                    disabled={busy !== null}
                    className={SECONDARY_BUTTON}
                  >
                    {busy === `leave:${myTeam.id}`
                      ? "Leaving..."
                      : myTeam.member_count <= 1
                        ? "Yes, leave and close the team"
                        : "Yes, leave"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmLeave(false)}
                    disabled={busy !== null}
                    className={SECONDARY_BUTTON}
                  >
                    Stay
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => { setActionError(""); setConfirmLeave(true); }}
                  disabled={busy !== null}
                  className={SECONDARY_BUTTON}
                >
                  Leave team
                </button>
              ))}
          </div>
          <p className="mt-3 text-sm text-themed-muted">
            {selfSelect
              ? "To switch teams, leave this one first. "
              : "Your instructor put you on this team. "}
            <Link href="/dashboard/teams" className="font-medium text-link underline hover:text-link-dark">
              Open team chat
            </Link>
          </p>
          {error}
        </>
      ) : selfSelect ? (
        <>
          <p className="mb-3 text-base text-themed-muted">
            This hunt is played in teams of up to {hunt.max_team_size}. Join a team or start your
            own, then you can start the hunt.
          </p>
          {!hunt.playable && (
            <p className="mb-3 text-sm text-themed-muted">Teams can&apos;t be changed until the hunt is open.</p>
          )}
        </>
      ) : viewer.can_manage ? (
        <>
          <p className="mb-3 text-base text-themed-text">
            {teams.length > 0
              ? "You run this hunt and aren't on a team yourself. You can still preview it."
              : "No teams have been formed for this hunt yet, so players can't start it. You can still preview it."}
          </p>
          {/* The sticky bar also says "Preview hunt", so this one stays secondary. */}
          {startLink("Preview hunt", SECONDARY_LINK)}
        </>
      ) : (
        <>
          <p className="text-base text-themed-text">
            Your instructor hasn&apos;t assigned teams yet. You&apos;ll be able to start once you&apos;re on a team.
          </p>
          <button type="button" onClick={retry} className={`${SECONDARY_BUTTON} mt-3`}>
            Check again
          </button>
        </>
      )}

      {(selfSelect || viewer.can_manage) && otherTeams.length > 0 && (
        <div className="mt-4 border-t border-themed-border pt-4">
          <h3 className="mb-2 text-sm font-semibold text-themed-text">
            {myTeam || !selfSelect ? "Other teams" : "Teams"}
          </h3>
          <ul className="space-y-2">
            {otherTeams.map((team) => {
              const open = JOINABLE_STATUSES.includes(team.status) && !team.is_full;
              return (
                <li
                  key={team.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-themed-border bg-themed-bg p-3"
                >
                  <TeamSummary team={team} viewerId={viewer.id} />
                  {selfSelect && !myTeam && (
                    <button
                      type="button"
                      onClick={() => join(team)}
                      disabled={!open || !hunt.playable || busy !== null}
                      aria-label={open ? `Join ${team.name}` : `${team.name} is ${team.is_full ? "full" : "closed"}`}
                      className={`${PRIMARY_BUTTON} shrink-0`}
                    >
                      {busy === `join:${team.id}` ? "Joining..." : team.is_full ? "Full" : open ? "Join" : "Closed"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {selfSelect && !myTeam && (
        <>
          {otherTeams.length === 0 && (
            <p className="mt-1 text-sm text-themed-muted">No teams yet. Be the first to start one.</p>
          )}
          <form onSubmit={create} className="mt-4 border-t border-themed-border pt-4">
            <label htmlFor="new-team-name" className="mb-1 block text-sm font-semibold text-themed-text">
              Create a team
            </label>
            <div className="flex flex-wrap gap-2">
              <input
                id="new-team-name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value.slice(0, TEAM_NAME_MAX))}
                maxLength={TEAM_NAME_MAX}
                placeholder="Team name"
                autoComplete="off"
                disabled={busy !== null || !hunt.playable}
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-themed-border bg-themed-bg px-3 text-base text-themed-text focus:border-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
              />
              <button
                type="submit"
                disabled={!teamName.trim() || busy !== null || !hunt.playable}
                className={PRIMARY_BUTTON}
              >
                {busy === "create" ? "Creating..." : "Create team"}
              </button>
            </div>
            <p className="mt-1 text-sm text-themed-muted">Other players in this hunt will see the team name.</p>
          </form>
          {error}
        </>
      )}
    </section>
  );
}
