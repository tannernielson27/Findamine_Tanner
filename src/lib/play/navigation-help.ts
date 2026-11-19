/**
 * How much help a hunt gives a player on the way to a stop (hunt metadata
 * `navigation_help`; "Difficulty" in the creator and player UI).
 *
 *   easy    the clue, a map with the stop on it, and the hot/cold meter
 *   medium  the clue and the hot/cold meter: no map, pin or direction
 *   hard    the clue only: no map, meter, distance or direction; the player
 *           taps "I'm here" when they think they have arrived
 *
 * Set per hunt by its creator. A hunt with no (or an unknown) value is easy,
 * which is how every hunt played before this setting existed.
 *
 * Not to be confused with clue delivery (lib/play/clue-delivery.ts), which is
 * the order stops are handed out in.
 *
 * The server enforces the level: see app/api/v1/play/_lib/stop-view.ts (what a
 * started stop carries) and the arrive route (distance and hot/cold zone). The
 * screen only follows what it is given.
 *
 * Pure: no I/O, unit tested directly.
 */

export const NAVIGATION_HELP_LEVELS = ["easy", "medium", "hard"] as const;
export type NavigationHelp = (typeof NAVIGATION_HELP_LEVELS)[number];

export const NAVIGATION_HELP_KEY = "navigation_help";
export const DEFAULT_NAVIGATION_HELP: NavigationHelp = "easy";

type Meta = Readonly<Record<string, unknown>> | null | undefined;

export function isNavigationHelp(value: unknown): value is NavigationHelp {
  return typeof value === "string" && (NAVIGATION_HELP_LEVELS as ReadonlyArray<string>).includes(value);
}

/** The hunt's level; easy when the setting is absent or not a known level. */
export function readNavigationHelp(metadata: Meta): NavigationHelp {
  const value = metadata?.[NAVIGATION_HELP_KEY];
  return isNavigationHelp(value) ? value : DEFAULT_NAVIGATION_HELP;
}

export interface NavigationAids {
  /** A map with the stop on it, the place name, and the direction to the stop. */
  map: boolean;
  /** The hot/cold meter and the distance to the stop. */
  meter: boolean;
}

/** Which aids a level allows. The clue is given at every level. */
export function navigationAids(level: NavigationHelp): NavigationAids {
  return { map: level === "easy", meter: level !== "hard" };
}

/** New metadata with the level set. Never mutates the input. */
export function withNavigationHelp(metadata: Meta, level: NavigationHelp): Record<string, unknown> {
  return { ...(metadata ?? {}), [NAVIGATION_HELP_KEY]: level };
}

/**
 * Does the level keep where the stop is off the device? True for Medium and
 * Hard. On those levels anything that can name the place (the challenge and
 * its hints) waits until the player has arrived.
 */
export function hidesPlace(level: NavigationHelp): boolean {
  return !navigationAids(level).map;
}

/**
 * An update that leaves the level out (a client that doesn't manage it) keeps
 * the stored one. Only a known level is carried over: a stored value that is
 * not a level reads as easy already, and copying it into the update would get
 * every later save rejected as an unknown difficulty. Returns `after`
 * unchanged otherwise; never mutates.
 */
export function inheritNavigationHelp<T extends Meta>(before: Meta, after: T): T | Record<string, unknown> {
  const stored = before?.[NAVIGATION_HELP_KEY];
  if (!isNavigationHelp(stored)) return after;
  if (after && NAVIGATION_HELP_KEY in after) return after;
  return { ...(after ?? {}), [NAVIGATION_HELP_KEY]: stored };
}

/** Did the effective level change? */
export function navigationHelpChanged(before: Meta, after: Meta): boolean {
  return readNavigationHelp(before) !== readNavigationHelp(after);
}

export const NAVIGATION_HELP_LOCKED_MESSAGE =
  "Difficulty is locked because this hunt has been published or played. Clone the hunt to use a different difficulty.";

export const NAVIGATION_HELP_UNKNOWN_MESSAGE = "Unknown difficulty. Choose Easy, Medium or Hard.";

export type NavigationHelpCheck = { ok: true } | { ok: false; status: 400 | 409; error: string };

/**
 * May this metadata update go through? An unknown level is always rejected.
 * A change of level is rejected once the hunt is locked: the same lock as
 * clue delivery (lib/hunts/delivery-lock.ts isDeliveryLocked: published, or
 * played by anyone). Changing it mid-hunt would be unfair, and for a study
 * hunt it would change the conditions.
 */
export function checkNavigationHelpEdit(input: { locked: boolean; before: Meta; after: Meta }): NavigationHelpCheck {
  const { locked, before, after } = input;
  const explicit = after?.[NAVIGATION_HELP_KEY];
  if (explicit !== undefined && !isNavigationHelp(explicit)) {
    return { ok: false, status: 400, error: NAVIGATION_HELP_UNKNOWN_MESSAGE };
  }
  if (locked && navigationHelpChanged(before, after)) {
    return { ok: false, status: 409, error: NAVIGATION_HELP_LOCKED_MESSAGE };
  }
  return { ok: true };
}

/** What the start route records on a new play session, for researchers. */
export function sessionNavigationHelpMetadata(level: NavigationHelp): Record<string, unknown> {
  return { [NAVIGATION_HELP_KEY]: level };
}

/** Completion metadata key: metres from the stop when the arrival was confirmed. */
const ARRIVAL_DISTANCE_KEY = "arrival_distance";

interface WithMetadata {
  metadata?: Record<string, unknown> | null;
}

/**
 * Hard: the player's own completion rows without how far from the stop they
 * were at check-in, so no play response carries a distance. The value stays in
 * the database for researchers. Other levels get the rows back as they are.
 * Use it on every play response that returns completion rows (progress,
 * complete). Never mutates.
 */
export function withoutArrivalDistance<T extends WithMetadata>(rows: T[], level: NavigationHelp): T[] {
  if (navigationAids(level).meter) return rows;
  return rows.map((row) => {
    if (!row.metadata || !(ARRIVAL_DISTANCE_KEY in row.metadata)) return row;
    const metadata = Object.fromEntries(Object.entries(row.metadata).filter(([key]) => key !== ARRIVAL_DISTANCE_KEY));
    return { ...row, metadata };
  });
}

export const NAVIGATION_HELP_LABELS: Record<NavigationHelp, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** One line for the hunt's creator. */
export const NAVIGATION_HELP_DESCRIPTIONS: Record<NavigationHelp, string> = {
  easy: "Players get the clue, a map with the stop on it, and the hot/cold meter.",
  medium: "Players get the clue and the hot/cold meter. No map.",
  hard: "Players get the clue only. No map and no hot/cold meter: they tap \"I'm here\" when they think they've arrived.",
};

/**
 * For the creator, under the picker on Medium and Hard: the setting takes the
 * map away, but it cannot stop their own words from naming the place.
 */
export const NAVIGATION_HELP_CREATOR_NOTE =
  "Check your own wording: a clue, clue hint, primer or safety note that names the place gives it away at any difficulty. The challenge and its hints are held back until the player arrives.";

/** One line for the player, on the hunt page before they start. */
export const NAVIGATION_HELP_PLAYER_DESCRIPTIONS: Record<NavigationHelp, string> = {
  easy: "You get the clue, a map showing each stop, and a hot/cold meter.",
  medium: "You get the clue and a hot/cold meter. There is no map.",
  hard: "You get the clue only: no map and no hot/cold meter. Tap \"I'm here\" when you think you've found the spot.",
};

/** Shown on the play screen while heading to a stop, when an aid is off. */
export const NAVIGATION_HELP_PLAY_NOTES: Partial<Record<NavigationHelp, string>> = {
  medium: "Medium difficulty: there's no map on this hunt. Follow the clue and the hot/cold meter.",
  hard: "Hard difficulty: there's no map or hot/cold meter on this hunt. Follow the clue, then tap \"I'm here\" when you think you've arrived.",
};
