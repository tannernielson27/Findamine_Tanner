/**
 * Pure navigation rules for the main navbar: which links a signed-in user sees.
 *
 * Kept free of React/DOM so the rules are unit tested directly. Two things are
 * decided here and both matter beyond cosmetics:
 *
 * 1. Role gating mirrors what each destination's page/API actually accepts, so
 *    the nav never offers a link the role is then rejected from.
 * 2. The Privacy link is the study's `privacy_friction` manipulation surface
 *    (prospectus Factor B). See `showPrivacyNavLink`.
 */

import { isWithdrawn } from "@/lib/utils/conditions";

export type PrivacyFriction = "low" | "high" | null | undefined;

export type NavIconKey = "dashboard" | "browse" | "leaderboard" | "create" | "rosters" | "admin" | "privacy";

export interface NavLink {
  href: string;
  label: string;
  icon: NavIconKey;
}

export interface NavUser {
  role: string;
  privacy_friction?: PrivacyFriction;
  metadata?: Record<string, unknown> | null;
}

/** Roles POST /api/v1/hunts accepts (hunt authoring). */
export const HUNT_CREATOR_ROLES: readonly string[] = ["teacher", "hunt_creator", "admin", "researcher"];
/** Roles /api/v1/roster* accepts — narrower than hunt authoring. */
export const ROSTER_ROLES: readonly string[] = ["teacher", "admin"];
/** Roles the /admin pages and /api/v1/admin/dashboard accept. */
export const ADMIN_ROLES: readonly string[] = ["admin", "researcher"];
/** Roles that play hunts and so appear on (and care about) the leaderboard. */
export const PLAYER_ROLES: readonly string[] = ["child", "teen", "adult", "parent"];

/**
 * Whether Privacy sits in the main nav, one click from anywhere.
 *
 * Hiding the link IS the high-friction manipulation (those participants reach
 * privacy via Settings → More → Privacy). Low friction is the baseline
 * experience, so the link is hidden ONLY for an explicit "high" assignment and
 * shown for "low", for an unassigned/unlinked factor (null/undefined), for any
 * unrecognized value, and for non-participants.
 *
 * Follows the `levelFromMetadata` convention in lib/utils/conditions.ts: a
 * withdrawn participant always gets the fallback (baseline) behavior and is
 * never manipulated again, whatever assignment is still on record.
 */
export function showPrivacyNavLink(
  friction: PrivacyFriction | string,
  metadata?: Record<string, unknown> | null
): boolean {
  if (isWithdrawn(metadata)) return true;
  return friction !== "high";
}

/** The ordered main-nav links for a signed-in user. Pure. */
export function navLinksFor(user: NavUser | null | undefined): NavLink[] {
  if (!user) return [];
  const has = (roles: readonly string[]) => roles.includes(user.role);

  return [
    { href: "/dashboard", label: "Dashboard", icon: "dashboard" as const },
    { href: "/browse", label: "Browse", icon: "browse" as const },
    ...(has(PLAYER_ROLES) ? [{ href: "/leaderboard", label: "Leaderboard", icon: "leaderboard" as const }] : []),
    ...(has(HUNT_CREATOR_ROLES) ? [{ href: "/dashboard/hunts/new", label: "Create", icon: "create" as const }] : []),
    ...(has(ROSTER_ROLES) ? [{ href: "/dashboard/rosters", label: "Rosters", icon: "rosters" as const }] : []),
    ...(has(ADMIN_ROLES) ? [{ href: "/admin", label: "Admin", icon: "admin" as const }] : []),
    ...(showPrivacyNavLink(user.privacy_friction, user.metadata)
      ? [{ href: "/settings/privacy", label: "Privacy", icon: "privacy" as const }]
      : []),
  ];
}
