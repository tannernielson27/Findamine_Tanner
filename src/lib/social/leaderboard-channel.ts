/**
 * Names shared by the server (which sends "this board changed" pings) and the
 * browser (which listens for them) over Supabase Realtime Broadcast.
 *
 * These channels carry no player data. A ping only says that a board changed;
 * the browser then asks GET /api/v1/leaderboard, which decides what this
 * viewer may see. Nothing about who scored, or what, is ever broadcast.
 */

/** The one event sent on a leaderboard channel. */
export const LEADERBOARD_CHANGED_EVENT = "changed";

const OVERALL_TOPIC = "leaderboard:overall";

/**
 * The Realtime channel for one board: a hunt's own board, or the overall board
 * when no hunt is given. Each hunt has its own channel, so boards open on
 * different hunts never hear each other's pings.
 */
export function leaderboardTopic(huntId?: string | null): string {
  return huntId ? `leaderboard:hunt:${huntId}` : OVERALL_TOPIC;
}
