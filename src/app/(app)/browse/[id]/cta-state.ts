/**
 * Which primary action the hunt detail page's sticky bar offers.
 *
 * - `sign_in_closed`: signed out, hunt not playable. Note plus Sign in.
 * - `closed`: signed in, hunt not playable. Note only.
 * - `sign_in`: signed out, hunt playable. "Sign in to play".
 * - `preview`: a team hunt the viewer runs but isn't on a team for. The team
 *   panel says the same and offers Preview as a secondary link.
 * - `team`: other team hunts. Scrolls to the team panel, which starts the hunt.
 * - `start`: solo hunts. "Start hunt".
 */
export type DetailCta = "sign_in_closed" | "closed" | "sign_in" | "preview" | "team" | "start";

export interface DetailCtaInput {
  playable: boolean;
  signedIn: boolean;
  teamHunt: boolean;
  /** The viewer manages this team hunt and isn't on any of its teams. */
  ownerPreview: boolean;
}

export function detailCta({ playable, signedIn, teamHunt, ownerPreview }: DetailCtaInput): DetailCta {
  if (!playable) return signedIn ? "closed" : "sign_in_closed";
  if (!signedIn) return "sign_in";
  if (teamHunt) return ownerPreview ? "preview" : "team";
  return "start";
}

/**
 * The team panel offers Preview only to a manager who isn't on a team, and
 * only on teacher-formed hunts (self-select hunts ask them to pick a team).
 * Mirrors the panel's branches so the sticky bar never contradicts it.
 */
export function isOwnerPreview({
  playMode,
  canManage,
  onTeam,
}: {
  playMode: unknown;
  canManage: boolean;
  onTeam: boolean;
}): boolean {
  const teamHunt = typeof playMode === "string" && playMode.startsWith("team_");
  return teamHunt && playMode !== "team_self_select" && canManage && !onTeam;
}
