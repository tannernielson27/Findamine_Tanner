/**
 * Which coordinates may be stored for a user.
 *
 * Children (under-13 accounts, COPPA) never have precise coordinates written
 * to the database: their photos stay on the device, and an arrival is recorded
 * only as a fact plus the distance from the stop. Coordinates are still used
 * in memory for the radius check and hot/cold hints; they are just not kept.
 *
 * Pure — unit tested directly.
 */

export interface StorableCoordinates {
  latitude: number | null;
  longitude: number | null;
}

export function storesPreciseLocation(role: string | null | undefined): boolean {
  return role !== "child";
}

export function coordinatesForStorage(
  role: string | null | undefined,
  latitude: number | null,
  longitude: number | null
): StorableCoordinates {
  if (!storesPreciseLocation(role)) return { latitude: null, longitude: null };
  return { latitude, longitude };
}

/** Parse an optional form-data coordinate ("" / missing / non-numeric → null). */
export function parseCoordinate(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
