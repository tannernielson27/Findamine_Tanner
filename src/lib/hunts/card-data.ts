/**
 * The one shape every hunt card renders from, plus pure formatters.
 *
 * Pages map their query rows into `HuntCardData` with `toHuntCardData`, so a
 * card never reaches into raw database columns.
 */

export interface HuntCardData {
  id: string;
  title: string;
  description?: string | null;
  /** Public URL of the creator's cover photo; null → generated topo art. */
  coverImageUrl?: string | null;
  /** kids | teens | adults | family | all */
  audience?: string | null;
  playMode?: string | null;
  durationMinutes?: number | null;
  stopCount?: number | null;
  /** Straight-line distance from the player to the hunt's centre, metres. */
  distanceMeters?: number | null;
  rating?: number | null;
  plays?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: string | null;
}

/** Row shape returned by the hunts list queries (columns are optional). */
export interface HuntListRow {
  id: string;
  title: string;
  description?: string | null;
  cover_image_url?: string | null;
  target_audience?: string | null;
  play_mode?: string | null;
  estimated_duration_min?: number | null;
  center_latitude?: number | null;
  center_longitude?: number | null;
  created_at?: string | null;
  /** PostgREST embedded count: `finds(count)`, filtered with `.is("finds.deleted_at", null)` so it counts live stops only. */
  finds?: Array<{ count: number }> | null;
}

export function toHuntCardData(row: HuntListRow): HuntCardData {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    coverImageUrl: row.cover_image_url ?? null,
    audience: row.target_audience ?? null,
    playMode: row.play_mode ?? null,
    durationMinutes: row.estimated_duration_min ?? null,
    stopCount: row.finds?.[0]?.count ?? null,
    latitude: row.center_latitude ?? null,
    longitude: row.center_longitude ?? null,
    createdAt: row.created_at ?? null,
  };
}

const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_M = 6371000;

/** Great-circle distance in metres. Pure. */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** "0.2 mi" (US campus audience). Under 0.1 mi shows feet. Pure. */
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  const miles = meters / METERS_PER_MILE;
  if (miles < 0.1) return `${Math.max(10, Math.round((meters * 3.28084) / 10) * 10)} ft`;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** "Solo" / "Team" for compact stats; full detail lives on the detail page. Pure. */
export function shortPlayMode(playMode: string | null | undefined): string | null {
  if (!playMode) return null;
  return playMode.startsWith("team") ? "Team" : "Solo";
}

/** Card stats line, e.g. ["0.2 mi", "6 stops", "45 min", "Solo"]. Pure. */
export function cardStats(hunt: HuntCardData): string[] {
  const out: string[] = [];
  const dist = formatDistance(hunt.distanceMeters);
  if (dist) out.push(dist);
  if (hunt.stopCount) out.push(`${hunt.stopCount} ${hunt.stopCount === 1 ? "stop" : "stops"}`);
  if (hunt.durationMinutes) out.push(`${hunt.durationMinutes} min`);
  const mode = shortPlayMode(hunt.playMode);
  if (mode) out.push(mode);
  return out;
}

/** Label for the cover tag: the hunt's audience in plain words. Pure. */
export function audienceLabel(audience: string | null | undefined): string | null {
  switch (audience) {
    case "kids": return "Kids";
    case "teens": return "Teens";
    case "adults": return "Adults";
    case "family": return "Family";
    case "all": return "All ages";
    default: return null;
  }
}

const COVER_PATH_PREFIX = "/storage/v1/object/public/hunt-covers/";

/**
 * The cover URL if it points into this project's hunt-covers bucket, else
 * null (the card then shows generated art). Defence in depth behind the
 * database guard in migration 079: covers are shown to every player, so an
 * outside host must never reach an <img src>. Pure.
 */
export function safeCoverUrl(
  url: string | null | undefined,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): string | null {
  if (!url || !supabaseUrl) return null;
  try {
    const parsed = new URL(url);
    const origin = new URL(supabaseUrl).origin;
    if (parsed.origin !== origin || parsed.username || parsed.password) return null;
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.pathname.startsWith(COVER_PATH_PREFIX) ? parsed.toString() : null;
  } catch {
    return null;
  }
}
