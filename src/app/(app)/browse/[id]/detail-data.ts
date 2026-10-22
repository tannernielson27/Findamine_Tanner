import type { createSupabaseServiceClient } from "@/lib/supabase/server";
import { isReviewer } from "@/lib/hunts/review";

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

type One<T> = T | T[] | null | undefined;
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface Place {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
  radius_meters: number | null;
}

export interface DetailFind {
  id: string;
  sort_order: number;
  deleted_at: string | null;
  clue_text: string | null;
  clue_hints: unknown;
  locations: Place | null;
  tasks: { title: string | null; challenge_type: string | null } | null;
  primers: unknown;
}

interface RawFind extends Omit<DetailFind, "locations" | "tasks"> {
  locations: One<Place>;
  tasks: One<{ title: string | null; challenge_type: string | null }>;
}

/** Live (not soft-deleted) stops in play order, with to-one embeds unwrapped. */
export function liveFinds(finds: RawFind[] | DetailFind[] | null | undefined): DetailFind[] {
  return ((finds ?? []) as RawFind[])
    .filter((f) => !f.deleted_at)
    .map((f) => ({ ...f, locations: one(f.locations), tasks: one(f.tasks) }))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Smallest start circle we draw, so a tight stop radius still reads as an area. */
const MIN_START_RADIUS_M = 40;
/** Circle around the hunt centre when no stop has coordinates. */
const CENTER_RADIUS_M = 150;

/**
 * Where the hunt starts: the first stop's arrival area (the play screen shows
 * the same circle as soon as a hunt starts), else the hunt centre. Never any
 * later stop.
 */
export function startArea(
  finds: DetailFind[],
  centerLat: number | null,
  centerLng: number | null
): { lat: number; lng: number; radius: number } | null {
  const first = finds[0]?.locations;
  if (first?.latitude && first?.longitude) {
    return {
      lat: first.latitude,
      lng: first.longitude,
      radius: Math.max(MIN_START_RADIUS_M, first.radius_meters ?? 0),
    };
  }
  if (centerLat != null && centerLng != null) return { lat: centerLat, lng: centerLng, radius: CENTER_RADIUS_M };
  return null;
}

/** Distinct challenge types across the stops, in first-seen order. */
export function challengeTypesOf(finds: DetailFind[]): string[] {
  return [...new Set(finds.map((f) => f.tasks?.challenge_type).filter((t): t is string => !!t))];
}

export interface HuntSocialProof {
  /** Average star rating, or null with no ratings. */
  rating: number | null;
  plays: number;
  /** Staff-made hunts say "by Findamine". Other creators' names are privacy-controlled, so they are left out. */
  byFindamine: boolean;
}

const RATING_SAMPLE = 1000;

export async function getHuntSocialProof(supabase: ServiceClient, huntId: string, createdBy: string): Promise<HuntSocialProof> {
  const [ratings, plays, creator] = await Promise.all([
    supabase.from("hunt_ratings").select("rating").eq("hunt_id", huntId).limit(RATING_SAMPLE),
    supabase.from("play_sessions").select("id", { count: "exact", head: true }).eq("hunt_id", huntId),
    supabase.from("users").select("role").eq("id", createdBy).maybeSingle(),
  ]);
  const values = (ratings.data ?? []).map((r) => Number(r.rating)).filter((n) => Number.isFinite(n) && n > 0);
  return {
    rating: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
    plays: plays.count ?? 0,
    byFindamine: isReviewer(creator.data?.role),
  };
}
