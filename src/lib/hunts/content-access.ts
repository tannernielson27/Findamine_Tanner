/**
 * Who may read which rows of the content tables (locations, tasks, primers)
 * through the API.
 *
 * These rows are what hunts are built from: a hunt's stops point at a place,
 * a challenge (with its answer key) and a primer. The API reads them with the
 * service role, so the rule has to be applied here; the database policies
 * (migration 088) apply the same one to anyone reading the tables directly.
 *
 *   - players never read them here: a stop reaches a player through the play
 *     API, piece by piece
 *   - a builder (teacher, hunt creator) reads the rows they created and the
 *     shared library
 *   - admins and researchers read everything
 *
 * Pure: no I/O, unit tested directly.
 */

import { ApiError } from "@/lib/utils/api-auth";

export const CONTENT_BUILDER_ROLES = ["teacher", "hunt_creator", "admin", "researcher"] as const;
const READ_ALL_ROLES: readonly string[] = ["admin", "researcher"];

export const LIBRARY_COLUMN = "is_library";

interface Reader {
  id: string;
  role: string;
}

export function isContentBuilder(role: string | null | undefined): boolean {
  return !!role && (CONTENT_BUILDER_ROLES as readonly string[]).includes(role);
}

/** Admins and researchers read every row. */
export function readsAllContent(role: string | null | undefined): boolean {
  return !!role && READ_ALL_ROLES.includes(role);
}

/** May this user read this row? Their own, or one in the shared library, unless they read everything. */
export function mayReadContentRow(
  user: Reader,
  row: Readonly<Record<string, unknown>> | null | undefined,
  ownerColumn = "created_by"
): boolean {
  if (!row || !isContentBuilder(user.role)) return false;
  return readsAllContent(user.role) || row[LIBRARY_COLUMN] === true || row[ownerColumn] === user.id;
}

/**
 * The library flag from a request body: undefined when it was not sent.
 * Strictly a boolean (the database would read "true" or 1 as true), and only
 * admins and researchers may put a row in the library every builder reads.
 */
export function parseLibraryFlag(value: unknown, role: string | null | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new ApiError(400, `${LIBRARY_COLUMN} must be true or false`);
  if (value && !readsAllContent(role)) throw new ApiError(403, "Only an admin can add items to the shared library");
  return value;
}

/**
 * The PostgREST "or" filter for "in the library, or mine". The user id goes
 * into a filter string, so anything that is not a plain id is refused rather
 * than escaped.
 */
export function ownOrLibraryFilter(userId: string, ownerColumn = "created_by"): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(userId) || !/^[a-z_]{1,64}$/.test(ownerColumn)) {
    throw new ApiError(400, "Invalid request");
  }
  return `${LIBRARY_COLUMN}.eq.true,${ownerColumn}.eq.${userId}`;
}
