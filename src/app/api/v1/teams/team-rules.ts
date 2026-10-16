import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { ApiError } from "@/lib/utils/api-auth";
import { assertCleanText } from "@/lib/moderation/guard";
import type { AuthUser } from "@/lib/types/database";
import { canAccessHunt } from "@/lib/hunts/review";

/**
 * Shared rules for team membership.
 *
 * The schema cannot enforce "one team per player per hunt" or "at most
 * max_size members" (team_members has no hunt_id, and a count is not a
 * constraint), and these routes run on PostgREST without a transaction. So
 * every write here is insert-then-verify: add the row, re-read the state the
 * rule is about, and remove the row again if the rule no longer holds. Whoever
 * commits last always sees the conflict, so a rule can never end up broken;
 * the worst case is two simultaneous requests both being asked to try again.
 */

export type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** How players end up on a team for a hunt. */
export type TeamMode = "solo" | "self_select" | "assigned";

/** hunts.play_mode -> who forms the teams. Every team_* mode but self-select is teacher-formed. */
export function teamModeOf(playMode: unknown): TeamMode {
  if (playMode === "team_self_select") return "self_select";
  if (typeof playMode === "string" && playMode.startsWith("team_")) return "assigned";
  return "solo";
}

/** Same statuses the play start route accepts. */
export const PLAYABLE_HUNT_STATUSES = ["published", "enrollment_open", "in_progress"];
/** Team statuses that still take new members. */
export const JOINABLE_TEAM_STATUSES = ["forming", "ready"];
export const DEFAULT_TEAM_SIZE = 6;
export const TEAM_NAME_MAX = 40;

export interface HuntForTeams {
  id: string;
  title: string | null;
  play_mode: string;
  status: string;
  review_status?: string | null;
  created_by: string | null;
  max_team_size: number | null;
  max_teams: number | null;
}

export interface TeamRow {
  id: string;
  hunt_id: string;
  name: string;
  status: string;
  max_size: number | null;
}

export async function loadHunt(supabase: ServiceClient, huntId: string): Promise<HuntForTeams | null> {
  const { data } = await supabase
    .from("hunts")
    .select("id, title, play_mode, status, review_status, created_by, max_team_size, max_teams")
    .eq("id", huntId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as HuntForTeams | null) ?? null;
}

/**
 * The hunt, if `user` may open it (see canAccessHunt): drafts and rejected
 * hunts only for their creator and reviewers, pending ones also for the
 * creator's roster students. Anything else reads as not found.
 */
export async function loadAccessibleHunt(
  supabase: ServiceClient,
  huntId: string,
  user: { id: string; role: string }
): Promise<HuntForTeams | null> {
  const hunt = await loadHunt(supabase, huntId);
  if (!hunt) return null;
  const access = { created_by: hunt.created_by ?? "", status: hunt.status, review_status: hunt.review_status ?? null };
  return (await canAccessHunt(supabase, access, user)) ? hunt : null;
}

export async function loadTeam(supabase: ServiceClient, teamId: string): Promise<TeamRow | null> {
  const { data } = await supabase
    .from("teams")
    .select("id, hunt_id, name, status, max_size")
    .eq("id", teamId)
    .maybeSingle();
  return (data as TeamRow | null) ?? null;
}

/** Hunt owner, admin or researcher: may set teams up and see all of them. */
export function canManageHunt(user: AuthUser, hunt: { created_by: string | null }): boolean {
  return hunt.created_by === user.id || ["admin", "researcher"].includes(user.role);
}

export function teamCapacity(team: { max_size: number | null }): number {
  return team.max_size && team.max_size > 0 ? team.max_size : DEFAULT_TEAM_SIZE;
}

/** Map a formation strategy onto the values teams.formation_method accepts. */
export function formationMethodFor(strategy: string): "manual" | "random" | "personality" | "balanced" {
  if (strategy === "teacher_assigned") return "manual";
  if (strategy === "random") return "random";
  if (strategy.startsWith("personality_")) return "personality";
  return "balanced";
}

/** First row per user from rows already sorted newest-first. */
export function latestPerUser<T extends { user_id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (seen.has(r.user_id)) return false;
    seen.add(r.user_id);
    return true;
  });
}

/** Trimmed team name, or a 400 the form can show. */
export function parseTeamName(raw: unknown, role?: string | null): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!name) throw new ApiError(400, "Give your team a name.");
  if (name.length > TEAM_NAME_MAX) {
    throw new ApiError(400, `Team names can be at most ${TEAM_NAME_MAX} characters.`);
  }
  assertCleanText(name, { role, label: "That team name" });
  return name;
}

/** Teams of a hunt that have not been disbanded. */
export async function liveTeams(supabase: ServiceClient, huntId: string): Promise<TeamRow[]> {
  const { data, error } = await supabase
    .from("teams")
    .select("id, hunt_id, name, status, max_size, created_at")
    .eq("hunt_id", huntId)
    .neq("status", "disbanded")
    .order("created_at");
  if (error) throw new ApiError(500, "Could not load teams");
  return (data || []) as TeamRow[];
}

/** Ids of the live teams in this hunt the user is an active member of. */
export async function activeTeamIdsInHunt(
  supabase: ServiceClient,
  userId: string,
  huntId: string
): Promise<string[]> {
  const teamIds = (await liveTeams(supabase, huntId)).map((t) => t.id);
  if (teamIds.length === 0) return [];
  const { data, error } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .in("team_id", teamIds);
  if (error) throw new ApiError(500, "Could not check your teams");
  return (data || []).map((m) => m.team_id as string);
}

export async function activeMemberCount(supabase: ServiceClient, teamId: string): Promise<number> {
  const { count, error } = await supabase
    .from("team_members")
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId)
    .eq("status", "active");
  if (error) throw new ApiError(500, "Could not check the team");
  return count || 0;
}

/** Is this user an active member (optionally: the captain) of the team? */
export async function isActiveMember(
  supabase: ServiceClient,
  teamId: string,
  userId: string,
  role?: "captain"
): Promise<boolean> {
  let query = supabase
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .eq("status", "active");
  if (role) query = query.eq("role", role);
  const { data } = await query.limit(1);
  return !!data && data.length > 0;
}

/**
 * Add `userId` to `team` as an active member, enforcing capacity and
 * one-team-per-hunt even when requests race (see the note at the top).
 * Throws a 409 with a player-facing message and leaves no row behind when a
 * rule would be broken.
 */
export async function addMember(
  supabase: ServiceClient,
  team: TeamRow,
  userId: string,
  role: "captain" | "member"
): Promise<{ id: string }> {
  const { data: member, error } = await supabase
    .from("team_members")
    .insert({ team_id: team.id, user_id: userId, role, status: "active" })
    .select("id")
    .single();

  if (error || !member) {
    // idx_team_members_unique: already an active member of this team.
    if (error?.code === "23505") throw new ApiError(409, "You're already on this team.");
    throw new ApiError(500, "Could not join the team. Please try again.");
  }

  const undo = async (status: number, message: string): Promise<never> => {
    await supabase.from("team_members").delete().eq("id", member.id);
    throw new ApiError(status, message);
  };

  try {
    const current = await loadTeam(supabase, team.id);
    if (!current || !JOINABLE_TEAM_STATUSES.includes(current.status)) {
      return await undo(409, "This team is no longer taking members.");
    }
    if ((await activeMemberCount(supabase, team.id)) > teamCapacity(current)) {
      return await undo(409, "That team just filled up. Pick another team or try again.");
    }
    if ((await activeTeamIdsInHunt(supabase, userId, team.hunt_id)).length > 1) {
      return await undo(409, "You're already on a team for this hunt. Leave it first to switch.");
    }
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 409) throw err;
    // A failed check must not leave an unverified membership behind.
    await supabase.from("team_members").delete().eq("id", member.id);
    throw err;
  }

  return { id: member.id as string };
}
