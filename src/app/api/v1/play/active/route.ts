import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { canAccessHunt } from "@/lib/hunts/review";
import { logger } from "@/lib/utils/logger";
import type { ActiveHunt } from "@/lib/play/active-hunt";
import {
  buildActiveHunt,
  rankSessions,
  type CompletionRow,
  type FindRow,
  type SessionRow,
} from "@/lib/play/active-hunt-builder";

/** Hunt statuses the start route lets a player resume (mirrors play/[huntId]/start). */
const PLAYABLE_STATUSES = ["published", "enrollment_open", "in_progress"];
/** Active sessions considered; a player rarely has more than a couple. */
const MAX_SESSIONS = 20;

const NO_STORE = { "Cache-Control": "private, no-store" };
const HUNT_COLUMNS = "id, title, status, created_by, review_status, deleted_at";
/** Postgres undefined_column. */
const UNDEFINED_COLUMN = "42703";

interface HuntRow {
  id: string;
  title: string;
  status: string;
  created_by: string;
  review_status: string | null;
  deleted_at: string | null;
  /** Absent until migration 079 is applied. */
  cover_image_url?: string | null;
}

function none(): Response {
  return Response.json({ data: null }, { headers: NO_STORE });
}

function failed(step: string, userId: string, message: string): never {
  logger.error("play.active.query_failed", { step, userId, error: message });
  throw new ApiError(500, "Couldn't load your hunt in progress.");
}

/**
 * GET /api/v1/play/active → { data: ActiveHunt | null }
 *
 * The signed-in player's unfinished hunt with the most recent activity, or
 * null when they have none or are signed out (the UI just hides the resume
 * card, so no 401). Sessions on hunts that can no longer be played (deleted,
 * unpublished, or no longer open to this player) are skipped.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) return none();

    const supabase = await createSupabaseServiceClient();

    const { data: sessionData, error: sessionError } = await supabase
      .from("play_sessions")
      .select("id, hunt_id, started_at, updated_at")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(MAX_SESSIONS);
    if (sessionError) failed("sessions", user.id, sessionError.message);
    const sessions = (sessionData || []) as SessionRow[];
    if (sessions.length === 0) return none();

    const { data: completionData, error: completionError } = await supabase
      .from("find_completions")
      .select("play_session_id, find_id, arrived_at, completed_at, created_at")
      .in("play_session_id", sessions.map((s) => s.id));
    if (completionError) failed("completions", user.id, completionError.message);
    const completions = (completionData || []) as CompletionRow[];

    const huntIds = [...new Set(sessions.map((s) => s.hunt_id))];
    const loadHunts = (columns: string) => supabase.from("hunts").select(columns).in("id", huntIds);
    let { data: huntData, error: huntError } = await loadHunts(`${HUNT_COLUMNS}, cover_image_url`);
    // hunts.cover_image_url arrives with migration 079; until it is applied,
    // retry once without it (covers fall back to null) instead of failing.
    if (huntError?.code === UNDEFINED_COLUMN) {
      logger.warn("play.active.cover_column_missing", { userId: user.id });
      ({ data: huntData, error: huntError } = await loadHunts(HUNT_COLUMNS));
    }
    if (huntError) failed("hunts", user.id, huntError.message);
    const hunts = new Map(((huntData || []) as unknown as HuntRow[]).map((h) => [h.id, h]));

    for (const session of rankSessions(sessions, completions)) {
      const hunt = hunts.get(session.hunt_id);
      if (!hunt || hunt.deleted_at || !PLAYABLE_STATUSES.includes(hunt.status)) continue;
      if (!(await canAccessHunt(supabase, hunt, user))) continue;

      const { data: findData, error: findError } = await supabase
        .from("finds")
        .select("id, sort_order")
        .eq("hunt_id", hunt.id)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (findError) failed("finds", user.id, findError.message);

      const active: ActiveHunt = buildActiveHunt(
        hunt,
        session.id,
        (findData || []) as FindRow[],
        completions,
        session.lastActiveAt
      );
      return Response.json({ data: active }, { headers: NO_STORE });
    }

    return none();
  } catch (error) {
    return errorResponse(error);
  }
}
