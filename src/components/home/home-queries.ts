import "server-only";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { toHuntCardData, type HuntCardData, type HuntListRow } from "@/lib/hunts/card-data";
import type { AgeBand } from "@/lib/themes/tokens";
import { logger } from "@/lib/utils/logger";
import { audiencesForBand } from "./home-data";
import type { CreatorHuntSummary } from "./your-hunts";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

const NEAR_LIMIT = 24;
const CARD_COLUMNS =
  "id, title, description, target_audience, play_mode, estimated_duration_min, center_latitude, center_longitude, created_at, finds(count)";
/**
 * Filter on the embedded `finds` resource so `finds(count)` counts only live
 * (not soft-deleted) stops. PostgREST applies a filter on an embedded resource
 * inside the embed, before the count aggregate; without `!inner` it never
 * removes parent hunt rows.
 */
const LIVE_STOPS_ONLY = "finds.deleted_at";

/**
 * Published public hunts for the player's audience band, newest first. The
 * client re-sorts by distance when location is already granted.
 *
 * hunts.cover_image_url is being added by the backend workstream; until that
 * migration is applied the query retries without it, so Home never breaks on
 * a database that doesn't have the column yet.
 */
export async function loadNearHunts(db: Db, band: AgeBand, role: string): Promise<HuntCardData[]> {
  const audiences = audiencesForBand(band, role);
  const run = (columns: string) =>
    db
      .from("hunts")
      .select(columns)
      .is("deleted_at", null)
      .is(LIVE_STOPS_ONLY, null)
      .eq("is_public", true)
      .in("status", ["published", "enrollment_open"])
      .in("target_audience", audiences)
      .order("created_at", { ascending: false })
      .limit(NEAR_LIMIT);

  let { data, error } = await run(`${CARD_COLUMNS}, cover_image_url`);
  if (error) ({ data, error } = await run(CARD_COLUMNS));
  if (error) {
    logger.error("home: near hunts query failed", { code: error.code });
    return [];
  }
  return ((data ?? []) as unknown as HuntListRow[]).map(toHuntCardData);
}

/** The creator's three most recently edited hunts plus their total count. */
export async function loadCreatorHunts(db: Db, userId: string): Promise<{ hunts: CreatorHuntSummary[]; total: number }> {
  const { data, count, error } = await db
    .from("hunts")
    .select("id, title, status, finds(count)", { count: "exact" })
    .eq("created_by", userId)
    .is("deleted_at", null)
    .is(LIVE_STOPS_ONLY, null)
    .order("updated_at", { ascending: false })
    .limit(3);
  if (error) {
    logger.error("home: creator hunts query failed", { code: error.code });
    return { hunts: [], total: 0 };
  }
  const rows = (data ?? []) as Array<{ id: string; title: string; status: string; finds?: Array<{ count: number }> | null }>;
  return {
    hunts: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, stopCount: r.finds?.[0]?.count ?? 0 })),
    total: count ?? rows.length,
  };
}
