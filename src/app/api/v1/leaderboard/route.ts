import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { resolveLeaderboardVisibility } from "@/lib/utils/leaderboard-visibility";
import { boardRanks, compareStanding, standingAmong, type ServerMe, type StandingKey } from "@/lib/social/standing";
import { comparableTotal, embeddedHuntMetadata, readScoringVersion } from "@/lib/hunts/scoring-version";

// Roles whose names are never shown publicly on leaderboards
const PROTECTED_ROLES = ["child", "teen"];

// How many ranked players the overall board scans to place the caller when
// they sit below the visible top-N. Beyond this, the reported rank is a floor.
const STANDING_SCAN_LIMIT = 1000;

interface LeaderboardUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  profile_visibility?: Record<string, string>;
}

/**
 * Redact display info for protected users based on the hunt's identity_mode.
 * - codename_assigned / codename_chosen: always show codename
 * - real_name: show real name for adults, initials for children/teens
 * - nameAllowed false (the player restricted display_name from this viewer)
 *   and no codename to fall back on: "Anonymous", never the real name
 *
 * `named` is true only when the row shows the player's own display name, i.e.
 * the board already tells this viewer who they are.
 */
function redactEntry(
  user: LeaderboardUser | null,
  codename: string | null,
  identityMode: string,
  nameAllowed: boolean
): { display_name: string | null; avatar_url: string | null; named: boolean } {
  if (!user) return { display_name: "Anonymous", avatar_url: null, named: false };

  // If hunt uses codenames, always show the codename
  if (identityMode !== "real_name" && codename) {
    return { display_name: codename, avatar_url: null, named: false };
  }

  if (!nameAllowed) return { display_name: "Anonymous", avatar_url: null, named: false };

  // real_name mode: protect children/teens with initials
  if (PROTECTED_ROLES.includes(user.role)) {
    const initials = (user.display_name || "?")
      .split(" ")
      .map((w: string) => w[0])
      .join("")
      .toUpperCase();
    return { display_name: initials || "?", avatar_url: null, named: false };
  }

  return { display_name: user.display_name, avatar_url: user.avatar_url, named: Boolean(user.display_name) };
}

/** What a completed session is ordered by on a board. */
function standingKey(row: Record<string, unknown>): StandingKey {
  return {
    score: (row.total_score as number | null) ?? 0,
    solveMs: typeof row.total_solve_ms === "number" ? row.total_solve_ms : null,
    completedAt: typeof row.completed_at === "string" ? row.completed_at : null,
  };
}

/**
 * Among the hunt's other finished sessions on exactly the viewer's score: how
 * many are ahead on the tiebreak, and whether any can't be separated from the
 * viewer at all. Equal scores are rare on version 2, so this set is small.
 */
async function levelWith(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  huntId: string,
  userId: string,
  mine: StandingKey
): Promise<{ ahead: number; tied: boolean }> {
  const { data } = await supabase
    .from("play_sessions")
    .select("user_id, total_score, total_solve_ms, completed_at")
    .eq("hunt_id", huntId)
    .eq("status", "completed")
    .eq("total_score", mine.score)
    .neq("user_id", userId)
    .limit(STANDING_SCAN_LIMIT);
  const others = ((data || []) as Record<string, unknown>[]).map((row) => compareStanding(standingKey(row), mine));
  return { ahead: others.filter((c) => c < 0).length, tied: others.some((c) => c === 0) };
}

/**
 * A row of the overall_leaderboard() SQL function (migrations 010 and 085).
 * total_score is already on the common scale: a stop counts out of 100
 * whichever scoring version its hunt uses.
 */
interface OverallRow {
  user_id: string;
  total_score: number;
  hunts_completed: number;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  best_codename: string | null;
}

export async function GET(request: NextRequest) {
  try {
    await generalLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const huntId = searchParams.get("hunt_id");
    const entryType = searchParams.get("type") || "user";
    const period = searchParams.get("period") || "all_time";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "25") || 25, 1), 100);

    const supabase = await createSupabaseServiceClient();

    // Check if the requesting user is a teacher/admin for this hunt
    // (teachers can see real names for their own hunts)
    let isHuntOwner = false;
    let currentUser: Awaited<ReturnType<typeof getAuthUser>>;

    if (huntId) {
      // Auth, the hunt's identity_mode, the board and the viewer's own session
      // are independent: run them together (the own-session read chains off auth).
      const authPromise = getAuthUser(request);
      const [user, { data: hunt }, { data }, mySessionResult] = await Promise.all([
        authPromise,
        supabase.from("hunts").select("identity_mode, created_by, metadata").eq("id", huntId).single(),
        // Hunt-specific: join play_sessions for codenames. Ordered by score,
        // then total solve time, then finish time (issue #11).
        supabase
          .from("play_sessions")
          .select(
            "user_id, total_score, total_solve_ms, completed_at, codename, users(id, display_name, avatar_url, role, profile_visibility)"
          )
          .eq("hunt_id", huntId)
          .eq("status", "completed")
          .order("total_score", { ascending: false })
          .order("total_solve_ms", { ascending: true, nullsFirst: false })
          .order("completed_at", { ascending: true, nullsFirst: false })
          .limit(limit),
        authPromise.then((u) =>
          u
            ? supabase
                .from("play_sessions")
                .select("total_score, total_solve_ms, completed_at")
                .eq("hunt_id", huntId)
                .eq("user_id", u.id)
                .eq("status", "completed")
                .maybeSingle()
            : null
        ),
      ]);
      currentUser = user;

      const identityMode = hunt?.identity_mode || "codename_assigned";
      // Version 2 hunts break ties, so equal scores get separate ranks.
      // Version 1 boards keep sharing a rank on equal scores, as they always
      // have; only the order of their tied rows is now fixed.
      const splitTies = readScoringVersion(hunt?.metadata as Record<string, unknown> | null) === 2;

      if (
        currentUser &&
        hunt &&
        (hunt.created_by === currentUser.id ||
          ["admin", "researcher"].includes(currentUser.role))
      ) {
        isHuntOwner = true;
      }

      // Enforce privacy on the two fields a leaderboard exposes: total_score
      // (restricted → the user is omitted from boards others see) and
      // display_name (restricted → redacted, falling back to codename in
      // real_name mode). Hunt owners/admins see the full board.
      const vis = isHuntOwner
        ? { drop: new Set<string>(), nameAllowed: new Map<string, boolean>() }
        : await resolveLeaderboardVisibility(
            currentUser?.id ?? null,
            (data || []).map((r) => r.user_id as string)
          );

      // Ranks are worked out over the rows this viewer sees, so a hidden
      // player never leaves a gap in the numbers.
      const visible = (data || [])
        .filter((row) => isHuntOwner || !vis.drop.has(row.user_id as string))
        .map((row) => ({ row: row as Record<string, unknown>, key: standingKey(row) }))
        .sort((a, b) => compareStanding(a.key, b.key));
      const ranks = boardRanks(visible.map((v) => v.key), { splitTies });

      const entries = visible
        .map(({ row }, index) => {
          // Supabase returns joined users as array or object depending on relation type
          const rawUsers = row.users;
          const user: LeaderboardUser | null = Array.isArray(rawUsers)
            ? (rawUsers[0] as LeaderboardUser) ?? null
            : (rawUsers as LeaderboardUser) ?? null;

          const codename = row.codename as string | null;

          const nameAllowed = isHuntOwner || (vis.nameAllowed.get(row.user_id as string) ?? false);
          const effectiveMode = nameAllowed ? identityMode : "codename_assigned";

          if (isHuntOwner) {
            return {
              user_id: row.user_id as string,
              score: row.total_score as number,
              rank: ranks[index],
              display_name: user?.display_name ?? null,
              avatar_url: user?.avatar_url ?? null,
              codename,
              profile_linkable: true,
            };
          }

          const { named, ...identity } = redactEntry(user, codename, effectiveMode, nameAllowed);
          return {
            user_id: row.user_id as string,
            score: row.total_score as number,
            rank: ranks[index],
            ...identity,
            // Only rows that already show the player's own name link to their
            // profile; linking a codename row would unmask the codename.
            profile_linkable: named,
          };
        });

      // Viewer's own standing — precise even when outside the visible top-N.
      // Self data, so no name-redaction applies. Motivation surface (B5).
      let me: ServerMe | null = null;
      if (currentUser) {
        const mySession = mySessionResult?.data;

        if (mySession) {
          const myScore = (mySession.total_score as number) ?? 0;
          const [{ count }, { data: nextRow }, level] = await Promise.all([
            supabase
              .from("play_sessions")
              .select("user_id", { count: "exact", head: true })
              .eq("hunt_id", huntId)
              .eq("status", "completed")
              .gt("total_score", myScore),
            supabase
              .from("play_sessions")
              .select("total_score")
              .eq("hunt_id", huntId)
              .eq("status", "completed")
              .gt("total_score", myScore)
              .order("total_score", { ascending: true })
              .limit(1)
              .maybeSingle(),
            // Version 2: everyone else on the same score, to place the viewer among them.
            splitTies
              ? levelWith(supabase, huntId, currentUser.id, standingKey(mySession))
              : Promise.resolve(null),
          ]);

          me = {
            rank: (count ?? 0) + (level?.ahead ?? 0) + 1,
            score: myScore,
            gap_to_next: level && level.ahead > 0 ? 0 : nextRow ? (nextRow.total_score as number) - myScore : null,
            ...(level ? { tied: level.tied } : {}),
          };
        }
      }

      return Response.json({
        entries,
        identity_mode: identityMode,
        viewer_id: currentUser?.id ?? null,
        me,
      });
    }

    currentUser = await getAuthUser(request);

    // Overall leaderboard: aggregated per user via RPC, always protect children.
    // For a signed-in caller the scan goes deeper than the visible page so their
    // own standing is known even when they sit below the top-N.
    const { data: ranked } = await supabase.rpc("overall_leaderboard", {
      p_limit: currentUser ? Math.max(limit, STANDING_SCAN_LIMIT) : limit,
    });
    const rankedRows = (ranked || []) as OverallRow[];
    const data = rankedRows.slice(0, limit);

    // Omit users who restricted total_score from viewers who can't see it, and
    // redact a restricted display_name that has no codename to stand in for it.
    const overallVis = await resolveLeaderboardVisibility(
      currentUser?.id ?? null,
      data.map((r) => r.user_id)
    );

    const entries = data
      .filter((row) => !overallVis.drop.has(row.user_id))
      .map((row) => {
        const user: LeaderboardUser = {
          id: row.user_id,
          display_name: row.display_name,
          avatar_url: row.avatar_url,
          role: row.role,
        };
        const { named, ...identity } = redactEntry(
          user,
          row.best_codename,
          "codename_assigned",
          overallVis.nameAllowed.get(row.user_id) ?? false
        );
        return {
          user_id: row.user_id,
          score: Number(row.total_score),
          hunts_completed: Number(row.hunts_completed),
          ...identity,
          profile_linkable: named,
        };
      });

    // Viewer's own standing (self data). null = no completed hunt yet, which the
    // board shows as "finish a hunt to get on the board".
    let me: ServerMe | null = null;
    if (currentUser) {
      me = standingAmong(
        rankedRows.map((r) => ({ user_id: r.user_id, score: Number(r.total_score) })),
        currentUser.id
      );
      if (!me && rankedRows.length >= STANDING_SCAN_LIMIT) {
        // Ranked, but below everyone the scan returned.
        const { data: own } = await supabase
          .from("play_sessions")
          .select("total_score, hunts(metadata)")
          .eq("user_id", currentUser.id)
          .eq("status", "completed");
        if (own && own.length > 0) {
          // The same sum overall_leaderboard() makes: every stop out of 100.
          const score = comparableTotal(
            (own as Record<string, unknown>[]).map((s) => ({
              score: s.total_score as number | null,
              version: readScoringVersion(embeddedHuntMetadata(s.hunts)),
            }))
          );
          const floor = Number(rankedRows[rankedRows.length - 1].total_score);
          me = {
            rank: rankedRows.length + 1,
            score,
            gap_to_next: floor > score ? floor - score : null,
          };
        }
      }
    }

    return Response.json({
      entries,
      identity_mode: "codename_assigned",
      viewer_id: currentUser?.id ?? null,
      me,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
