import { ApiError } from "@/lib/utils/api-auth";

/** Arrival radius bounds, in meters. Below ~5 m phone GPS can't reliably hit it. */
export const MIN_RADIUS_METERS = 5;
export const MAX_RADIUS_METERS = 1000;

/**
 * Validate a latitude/longitude pair from a request body.
 * (0, 0) is rejected: it is the "no GPS yet" placeholder, never a real stop.
 */
export function parseCoordinates(latitude: unknown, longitude: unknown): { lat: number; lng: number } {
  if (latitude == null || longitude == null || latitude === "" || longitude === "") {
    throw new ApiError(400, "Latitude and longitude are required");
  }

  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new ApiError(400, "Invalid coordinates: latitude must be -90 to 90, longitude -180 to 180");
  }
  if (lat === 0 && lng === 0) {
    throw new ApiError(400, "Coordinates (0, 0) are not a real location — pick the stop's position on the map");
  }

  return { lat, lng };
}

/** Validate an arrival radius. Returns undefined when none was sent. */
export function parseRadius(radius: unknown): number | undefined {
  if (radius === undefined || radius === null || radius === "") return undefined;

  const meters = Number(radius);
  if (!Number.isFinite(meters) || meters < MIN_RADIUS_METERS || meters > MAX_RADIUS_METERS) {
    throw new ApiError(400, `Radius must be between ${MIN_RADIUS_METERS} and ${MAX_RADIUS_METERS} meters`);
  }
  return meters;
}
