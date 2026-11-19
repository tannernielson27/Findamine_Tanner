/**
 * Server side of the live leaderboard: tell open boards that standings changed.
 *
 * Sent through Supabase Realtime Broadcast's REST endpoint, so a route handler
 * needs no WebSocket. The message carries no player data (see
 * leaderboard-channel.ts); browsers refetch the board from the API, which
 * applies the usual visibility rules per viewer.
 *
 * Call this after anything that changes what a board shows:
 *   - a session completing (/complete): the overall board and a play-anytime
 *     hunt's board list finished hunts only;
 *   - a scored stop on a scheduled hunt (/answer): its board is a running
 *     total of sessions still in progress.
 * A newly started session has no points and is on no board.
 */

import { logger } from "@/lib/utils/logger";
import { LEADERBOARD_CHANGED_EVENT, leaderboardTopic } from "./leaderboard-channel";

/** Give up on a slow Realtime quickly; the browsers' poll covers a lost ping. */
const PING_TIMEOUT_MS = 2_000;

/**
 * Ping the hunt's board and the overall board. Never throws and never
 * rejects: a failed ping is logged and the boards catch up on their next poll.
 */
export async function notifyLeaderboardChanged(huntId: string): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  const messages = [leaderboardTopic(huntId), leaderboardTopic()].map((topic) => ({
    topic,
    event: LEADERBOARD_CHANGED_EVENT,
    payload: { changed: true },
  }));

  try {
    const response = await fetch(`${supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: serviceKey, "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger.warn("leaderboard.ping_failed", { huntId, status: response.status });
    }
  } catch (error) {
    logger.warn("leaderboard.ping_failed", {
      huntId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
