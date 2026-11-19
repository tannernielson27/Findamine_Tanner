/**
 * Real names on the leaderboard (issue #13), for the people running an event.
 *
 * Who may see them: platform admins and researchers on any board, and a hunt's
 * creator on that hunt's board. Nobody else, and nobody on the overall board
 * except admins and researchers. The API enforces this (GET /api/v1/leaderboard
 * adds real names only for an allowed caller who also sends real_names=1); the
 * board's toggle is a convenience, never the control.
 *
 * It only changes the asking viewer's own response. What other players see is
 * decided by the unchanged privacy rules (lib/utils/leaderboard-visibility).
 *
 * Pure, with no I/O, so the browser and the server share one rule.
 */

import { ageInYears } from "@/lib/utils/registration";

/** Query parameter that asks for real names, and the only value that means yes. */
export const REAL_NAMES_PARAM = "real_names";
export const REAL_NAMES_ON = "1";

/** Staff who may see real names on every board. */
const REAL_NAME_STAFF_ROLES: readonly string[] = ["admin", "researcher"];

/**
 * Accounts whose real name is never returned: children and teens (the roles the
 * leaderboard already protects), anyone whose date of birth says under 18, and
 * anyone whose stored age band is below adult. Any one of the three is enough.
 */
const MINOR_ROLES: readonly string[] = ["child", "teen"];
const MINOR_BANDS: readonly string[] = ["primary", "intermediate", "teen"];
const ADULT_AGE = 18;

export interface RealNameViewer {
  id: string;
  role: string;
}

export function isRealNameStaff(role: string | null | undefined): boolean {
  return typeof role === "string" && REAL_NAME_STAFF_ROLES.includes(role);
}

/**
 * May this viewer see real names on a board? Pass the hunt's creator for a
 * hunt board; leave it out for the overall board, where only staff qualify.
 */
export function canViewRealNames(
  viewer: RealNameViewer | null | undefined,
  huntCreatedBy?: string | null
): boolean {
  if (!viewer) return false;
  if (isRealNameStaff(viewer.role)) return true;
  return Boolean(huntCreatedBy) && huntCreatedBy === viewer.id;
}

/** Did the request explicitly ask for real names? Anything but real_names=1 is no. */
export function realNamesRequested(params: URLSearchParams): boolean {
  return params.get(REAL_NAMES_PARAM) === REAL_NAMES_ON;
}

/** The board request the leaderboard makes. Real names are asked for only when switched on. */
export function boardRequestPath(huntId: string | undefined, realNames: boolean): string {
  const params: string[] = [];
  if (huntId) params.push(`hunt_id=${encodeURIComponent(huntId)}`);
  if (realNames) params.push(`${REAL_NAMES_PARAM}=${REAL_NAMES_ON}`);
  return `/api/v1/leaderboard${params.length > 0 ? `?${params.join("&")}` : ""}`;
}

/**
 * on_file: the player saved a real name on their profile.
 * not_on_file: they did not (the field is optional).
 * withheld_minor: a child, a teen or someone under 18; never returned.
 */
export type RealNameStatus = "on_file" | "not_on_file" | "withheld_minor";

export interface RealNameFields {
  real_name: string | null;
  real_name_status: RealNameStatus;
}

/** The parts of a users row that decide a real name. Email is not among them. */
export interface RealNameSubject {
  role?: string | null;
  date_of_birth?: string | null;
  /** users.metadata; the real name is its `real_name` key (set on the profile page). */
  metadata?: unknown;
  deleted_at?: string | null;
  /** user_profiles.effective_band, when the player has a profile row. */
  effective_band?: string | null;
}

const NOT_ON_FILE: RealNameFields = { real_name: null, real_name_status: "not_on_file" };
const WITHHELD_MINOR: RealNameFields = { real_name: null, real_name_status: "withheld_minor" };

function isMinor(subject: RealNameSubject, now: number): boolean {
  if (typeof subject.role === "string" && MINOR_ROLES.includes(subject.role)) return true;
  if (typeof subject.effective_band === "string" && MINOR_BANDS.includes(subject.effective_band)) return true;
  if (!subject.date_of_birth) return false;
  // NaN (an unreadable date) fails the comparison, so it counts as under 18.
  return !(ageInYears(subject.date_of_birth, now) >= ADULT_AGE);
}

/**
 * The real name to show an allowed viewer for one player: the name saved on
 * their profile, or a status saying why there is none. Never an email address
 * and never the display name.
 */
export function resolveRealName(
  subject: RealNameSubject | null | undefined,
  now: number = Date.now()
): RealNameFields {
  if (!subject || subject.deleted_at) return { ...NOT_ON_FILE };
  if (isMinor(subject, now)) return { ...WITHHELD_MINOR };

  const metadata = subject.metadata;
  const stored =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).real_name
      : null;
  const name = typeof stored === "string" ? stored.trim() : "";
  return name ? { real_name: name, real_name_status: "on_file" } : { ...NOT_ON_FILE };
}

export type WithRealName<T> = T & RealNameFields & {
  /**
   * The name the board shows other players for this row (a codename, a display
   * name, or initials). It says nothing about the player's own privacy
   * settings, which can hide that name from some viewers.
   */
  shown_as: string | null;
};

/**
 * Add the real-name fields to board rows. Returns new rows; a player missing
 * from `names` is reported as having none on file.
 */
export function withRealNames<T extends { user_id: string }>(
  entries: readonly T[],
  names: ReadonlyMap<string, RealNameFields>,
  shownAs: ReadonlyMap<string, string>
): WithRealName<T>[] {
  return entries.map((entry) => ({
    ...entry,
    ...(names.get(entry.user_id) ?? NOT_ON_FILE),
    shown_as: shownAs.get(entry.user_id) ?? null,
  }));
}

/**
 * A line telling the person running the event what other players see for this
 * row, when it differs from the name the row already shows them. null when
 * there is nothing to add.
 */
export function otherPlayersNote(rowName: string, shownAs: string | null | undefined): string | null {
  if (!shownAs || shownAs === rowName) return null;
  return `Players see: ${shownAs}`;
}

/** What the board prints in the real-name slot: the name, or why there isn't one. */
export function realNameLabel(fields: Partial<RealNameFields>): string {
  if (fields.real_name_status === "withheld_minor") return "Withheld (under 18)";
  return fields.real_name || "No real name on file";
}
