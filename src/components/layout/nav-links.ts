/**
 * Pure navigation rules for the app shell (top bar, bottom tab bar) and the
 * legacy navbar link list: which destinations a signed-in user sees.
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

/* ─── App shell (design overhaul): bottom tab bar + top bar ──────────────── */
/* navLinksFor above is the pre-overhaul destination list. It is kept (with
   its tests) as the record of what every role could reach from the old
   navbar; the shell below must keep all of it reachable. */

export type TabIconKey = "home" | "explore" | "ranks" | "hunts" | "profile";

export interface TabLink {
  href: string;
  label: string;
  icon: TabIconKey;
}

const HOME_TAB: TabLink = { href: "/dashboard", label: "Home", icon: "home" };
const EXPLORE_TAB: TabLink = { href: "/browse", label: "Explore", icon: "explore" };
const RANKS_TAB: TabLink = { href: "/leaderboard", label: "Ranks", icon: "ranks" };
const MY_HUNTS_TAB: TabLink = { href: "/dashboard/hunts", label: "My Hunts", icon: "hunts" };
const PROFILE_TAB: TabLink = { href: "/dashboard/profile", label: "Profile", icon: "profile" };

/**
 * The bottom tab bar (and the lg+ top nav) for a signed-in user. Pure.
 *
 * Tabs are places, never actions (Apple HIG): "Create" lives as a "+" inside
 * My Hunts. Players get Ranks; anyone who can author hunts (teachers,
 * creators, admins, researchers) gets My Hunts in that slot. Rosters and
 * Admin are rare destinations and live in Profile. Privacy is NOT a tab: see
 * `showPrivacyShield`.
 */
export function tabsFor(user: Pick<NavUser, "role"> | null | undefined): TabLink[] {
  if (!user) return [];
  if (HUNT_CREATOR_ROLES.includes(user.role)) return [HOME_TAB, EXPLORE_TAB, MY_HUNTS_TAB, PROFILE_TAB];
  if (PLAYER_ROLES.includes(user.role)) return [HOME_TAB, EXPLORE_TAB, RANKS_TAB, PROFILE_TAB];
  return [HOME_TAB, EXPLORE_TAB, PROFILE_TAB];
}

/** Pages reached from the Profile tab: the Profile tab stays lit on them. */
const PROFILE_SECTION_PREFIXES = [
  "/dashboard/profile",
  "/dashboard/badges",
  "/dashboard/social",
  "/dashboard/teams",
  "/dashboard/rosters",
  "/dashboard/assessment",
  "/dashboard/join-class",
  "/settings",
  "/admin",
  "/profile",
];

function under(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Which tab is current for a path, or null when none is. Pure. */
export function activeTabHref(tabs: readonly TabLink[], pathname: string): string | null {
  const has = (href: string) => tabs.some((t) => t.href === href);
  const pick = (href: string) => (has(href) ? href : null);
  if (pathname === "/dashboard") return pick("/dashboard");
  if (under(pathname, "/dashboard/hunts")) return pick("/dashboard/hunts");
  if (under(pathname, "/browse")) return pick("/browse");
  if (under(pathname, "/leaderboard")) return pick("/leaderboard");
  if (PROFILE_SECTION_PREFIXES.some((p) => under(pathname, p))) return pick("/dashboard/profile");
  return null;
}

export interface ShellChrome {
  /** Logo/greeting + bell (+ Privacy shield) header. */
  topBar: boolean;
  /** Floating bottom tab bar (below lg; lg+ uses the top-bar nav instead). */
  tabBar: boolean;
  /** Active-hunt mini-bar may show (only when a hunt is actually in progress). */
  miniBar: boolean;
}

/** /browse/<id> is a hunt detail page; /browse/standards is a listing. */
function isHuntDetail(pathname: string): boolean {
  const m = /^\/browse\/([^/]+)/.exec(pathname);
  return !!m && m[1] !== "standards";
}

/**
 * Which shell pieces a path gets. Pure.
 * - Play is full screen: no top bar, no tab bar.
 * - Hunt detail has its own hero + sticky "Start hunt" bar: no shell chrome.
 * - Admin tools, surveys and the debrief are focused flows (admin also has
 *   its own fixed bottom controls): top bar only.
 * - Home has the big resume card, so no mini-bar there.
 */
export function shellChromeFor(pathname: string): ShellChrome {
  if (under(pathname, "/play") || isHuntDetail(pathname)) {
    return { topBar: false, tabBar: false, miniBar: false };
  }
  if (under(pathname, "/admin") || under(pathname, "/surveys") || under(pathname, "/debrief")) {
    return { topBar: true, tabBar: false, miniBar: false };
  }
  return { topBar: true, tabBar: true, miniBar: pathname !== "/dashboard" };
}

export type ProfileLinkIcon = "settings" | "privacy" | "social" | "teams" | "rosters" | "admin" | "policy" | "terms";

export interface ProfileLink {
  href: string;
  label: string;
  description?: string;
  icon: ProfileLinkIcon;
}

/**
 * Whether the Profile tab lists "Privacy settings" directly. This is the
 * low-friction entry point (it replaced the top-bar shield, which replaced the
 * old "Privacy" main-nav link) and follows exactly the same rule,
 * `showPrivacyNavLink`: hidden only for an explicit high-friction assignment,
 * who keep reaching privacy via Profile → Settings → More → Privacy settings.
 *
 * STUDY NOTE: the low-friction path is now two taps (Profile → Privacy
 * settings) instead of one from every screen. That changes what "low
 * friction" looks like and needs Dr. Keith's sign-off before a cohort with
 * friction linked uses it.
 */
export function showPrivacyProfileRow(user: Pick<NavUser, "privacy_friction" | "metadata"> | null | undefined): boolean {
  if (!user) return false;
  return showPrivacyNavLink(user.privacy_friction, user.metadata);
}

/**
 * The Profile tab's settings list: everything that used to sit in the
 * hamburger menu or the old Home shortcut rows, plus the Privacy settings row
 * for everyone except high-friction participants (`showPrivacyProfileRow`).
 * Pure.
 */
export function profileLinksFor(
  role: string,
  user?: Pick<NavUser, "privacy_friction" | "metadata"> | null
): ProfileLink[] {
  return [
    { href: "/settings", label: "Settings", description: "Name, email, password", icon: "settings" },
    ...(showPrivacyProfileRow(user)
      ? [{ href: "/settings/privacy", label: "Privacy settings", description: "Who can see parts of your profile", icon: "privacy" as const }]
      : []),
    { href: "/dashboard/social", label: "Social & friends", description: "Friends, crew and kudos", icon: "social" },
    { href: "/dashboard/teams", label: "Teams", description: "Your hunt teams", icon: "teams" },
    ...(ROSTER_ROLES.includes(role)
      ? [{ href: "/dashboard/rosters", label: "Rosters", description: "Classes and students", icon: "rosters" as const }]
      : []),
    ...(ADMIN_ROLES.includes(role)
      ? [{ href: "/admin", label: "Admin", description: "Research and moderation tools", icon: "admin" as const }]
      : []),
    { href: "/privacy", label: "Privacy Policy", icon: "policy" },
    { href: "/terms", label: "Terms of Use", icon: "terms" },
  ];
}
