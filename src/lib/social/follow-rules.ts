/**
 * Rules for one-way follows and for the social audiences they create.
 * Pure (no I/O), shared by the API, the viewer-relationship resolver and the UI.
 *
 * A follow needs no approval. It is open to adults and staff only: children
 * and teens keep the team / class audiences they have always had, and nobody
 * can follow them.
 */

import { VISIBILITY_LABELS, type VisibilityLevel } from "@/lib/utils/privacy";

/** Roles that never follow, are never followed, and keep team / class audiences. */
const MINOR_ROLES: ReadonlySet<string> = new Set(["child", "teen"]);

/** May an account with this role follow people and be followed? */
export function canUseFollows(role: string | null | undefined): boolean {
  return typeof role === "string" && role.length > 0 && !MINOR_ROLES.has(role);
}

/**
 * Do this account's "team" and "class" audiences also cover its social ties
 * (crew, people it follows)? The same accounts that can use follows.
 */
export function usesSocialAudiences(role: string | null | undefined): boolean {
  return canUseFollows(role);
}

/** How a viewer came to their place in someone's audiences. */
export type RelationshipVia = "self" | "team" | "class" | "crew" | "follow" | "public";

export type SocialTier = "team" | "class";

/** The audience a social tie puts the viewer in. */
export const SOCIAL_TIER: Readonly<Record<"crew" | "follow", SocialTier>> = {
  // Recruiter and recruit, either direction.
  crew: "team",
  // The profile's owner follows the viewer.
  follow: "class",
};

/**
 * Audience names for accounts whose audiences cover social ties. The stored
 * levels stay nobody / team / class / everyone; only the wording differs.
 */
export const SOCIAL_AUDIENCE_LABELS: Readonly<
  Record<VisibilityLevel, { label: string; icon: string; description: string }>
> = {
  nobody: { label: "Only Me", icon: "🔒", description: "Nobody else can see this" },
  team: { label: "My Crew", icon: "👥", description: "Your crew, and teammates on team hunts" },
  class: { label: "Crew + Following", icon: "🤝", description: "Your crew, plus players you follow" },
  everyone: { label: "Everyone", icon: "🌍", description: "All findamine users" },
};

/** Audience names to show an account with this role. */
export function audienceLabelsFor(
  role: string | null | undefined
): Readonly<Record<VisibilityLevel, { label: string; icon: string; description: string }>> {
  return usesSocialAudiences(role) ? SOCIAL_AUDIENCE_LABELS : VISIBILITY_LABELS;
}

/** `notifications.type` written when someone starts following a player. */
export const NEW_FOLLOWER_TYPE = "new_follower";
/** Where the lists of followers and followed players live. */
export const FOLLOWS_PAGE_PATH = "/dashboard/social";

export const FOLLOW_UNAVAILABLE_MESSAGE = "Following isn't available for this account.";
export const FOLLOW_SELF_MESSAGE = "You can't follow yourself.";
export const FOLLOW_BLOCKED_MESSAGE = "You can't follow this player.";
