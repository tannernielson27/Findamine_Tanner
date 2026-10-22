/**
 * Pure onboarding configuration + role routing.
 *
 * Kept free of React/DOM so the first-run funnel logic (which steps a role sees,
 * where "get started" sends them, which milestone marks completion) is unit-testable.
 *
 * The welcome tour walks the real app: each step can open a page (`route`) and
 * spotlight an element on it (`anchor`, matched against `data-tour-anchor`).
 * Tour content is identical across privacy conditions — only role tailors it.
 * The one privacy stop (`PRIVACY_STEP`) shows WHERE the controls live, in
 * neutral words, and never suggests changing them; its page is read-only while
 * the tour is on it (see tour-mode.ts).
 */

export interface OnboardingStep {
  id: string;
  title: string;
  body: string;
  icon: string;
  /** Page the tour opens for this step. Absent: stay on the current page. */
  route?: string;
  /** `data-tour-anchor` value to spotlight. Absent: a centered card. */
  anchor?: string;
}

/** Milestone the API (GET /api/v1/onboarding) reads to compute next steps. */
export const ONBOARDING_MILESTONE = "onboarding_completed";

/** Query flag that opens /settings/privacy read-only for the tour. */
export const PRIVACY_TOUR_PARAM = "tour";
export const PRIVACY_TOUR_ROUTE = `/settings/privacy?${PRIVACY_TOUR_PARAM}=1`;
/** Anchor the privacy page puts on the first block of whichever controls it shows. */
export const PRIVACY_TOUR_ANCHOR = "privacy-controls";

const CREATOR_ROLES = new Set(["teacher", "hunt_creator", "admin"]);

export function isCreatorRole(role?: string | null): boolean {
  return role ? CREATOR_ROLES.has(role) : false;
}

/** Where the final "get started" CTA propels a user for their first fun moment. */
export function onboardingDestination(role?: string | null): string {
  return isCreatorRole(role) ? "/dashboard/hunts" : "/browse";
}

/** Label for the final CTA. */
export function finalCtaLabel(role?: string | null): string {
  return isCreatorRole(role) ? "Build a hunt →" : "Start exploring →";
}

/** Anchor for a bottom-tab / top-nav destination (tab-bar.tsx, top-bar.tsx). */
export function tabAnchor(icon: string): string {
  return `tab:${icon}`;
}

/**
 * The privacy stop. Same words in every condition: says what the screen is,
 * where to find it again ("under Profile" is true in every friction arm: a
 * direct row for low friction, Profile → Settings → More for high), and that
 * nothing needs doing now.
 */
export const PRIVACY_STEP: OnboardingStep = {
  id: "privacy",
  title: "Your privacy settings",
  body: "This screen is where you choose who can see parts of your profile. You don't need to do anything here now. You can find it under Profile whenever you want it.",
  icon: "🔒",
  route: PRIVACY_TOUR_ROUTE,
  anchor: PRIVACY_TOUR_ANCHOR,
};

const PLAYER_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to findamine!",
    body: "It's a GPS treasure hunt: real places, real clues, real points. Here's a quick look around.",
    icon: "🗺️",
    route: "/dashboard",
  },
  {
    id: "home",
    title: "Home",
    body: "Your hunt in progress, your weekly streak, and what to play next all live here.",
    icon: "🏠",
    route: "/dashboard",
    anchor: tabAnchor("home"),
  },
  {
    id: "explore",
    title: "Explore",
    body: "Find hunts near you, in a list or on the map. Tap one to see where it starts and how long it takes.",
    icon: "🧭",
    route: "/browse",
    anchor: tabAnchor("explore"),
  },
  {
    id: "play",
    title: "How a hunt works",
    body: "Each hunt is a string of stops. Read the clue and let the hot/cold meter pull you in. At each stop a challenge unlocks: nail it for points, or grab a hint if you're stuck.",
    icon: "🧩",
    route: "/browse",
  },
  {
    id: "ranks",
    title: "Ranks",
    body: "Every find adds to your score. See how you stack up on the leaderboard.",
    icon: "🏆",
    route: "/leaderboard",
    anchor: tabAnchor("ranks"),
  },
  {
    id: "profile",
    title: "Profile",
    body: "Your badges, friends, teams and account settings.",
    icon: "🙂",
    route: "/dashboard/profile",
    anchor: tabAnchor("profile"),
  },
  PRIVACY_STEP,
  {
    id: "done",
    title: "You're all set",
    body: "That's the tour. Ready to find your first hunt?",
    icon: "🚀",
  },
];

const CREATOR_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to findamine!",
    body: "You build GPS treasure hunts and watch players chase them through the real world. Here's a quick look around.",
    icon: "🗺️",
    route: "/dashboard",
  },
  {
    id: "home",
    title: "Home",
    body: "Your latest activity and shortcuts back into your work.",
    icon: "🏠",
    route: "/dashboard",
    anchor: tabAnchor("home"),
  },
  {
    id: "explore",
    title: "Explore",
    body: "Every published hunt, in a list or on the map. A good place to borrow ideas.",
    icon: "🧭",
    route: "/browse",
    anchor: tabAnchor("explore"),
  },
  {
    id: "hunts",
    title: "My Hunts",
    body: "A hunt is a trail of stops, each with a location, a clue and a challenge. Build, edit and publish yours here.",
    icon: "📍",
    route: "/dashboard/hunts",
    anchor: tabAnchor("hunts"),
  },
  {
    id: "profile",
    title: "Profile",
    body: "Your account settings, teams and classes.",
    icon: "🙂",
    route: "/dashboard/profile",
    anchor: tabAnchor("profile"),
  },
  PRIVACY_STEP,
  {
    id: "done",
    title: "You're all set",
    body: "That's the tour. Let's build your first hunt.",
    icon: "🚀",
  },
];

export function stepsForRole(role?: string | null): OnboardingStep[] {
  return isCreatorRole(role) ? CREATOR_STEPS : PLAYER_STEPS;
}

/**
 * Drop steps whose tab the user doesn't have (e.g. Ranks for a role with no
 * leaderboard), so the tour never spotlights something that isn't there.
 * `tabIcons` are the icons of the tabs this user actually sees. Pure.
 */
export function stepsForUser(role: string | null | undefined, tabIcons: readonly string[]): OnboardingStep[] {
  const tabs = new Set(tabIcons.map(tabAnchor));
  return stepsForRole(role).filter((s) => !s.anchor?.startsWith("tab:") || tabs.has(s.anchor));
}

/** Clamp a stored step index into range (a role change can shorten the tour). Pure. */
export function clampStep(index: number, length: number): number {
  if (!Number.isInteger(index) || index < 0 || length === 0) return 0;
  return Math.min(index, length - 1);
}
