import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";
import { botGuard } from "@/lib/utils/bot-guard";
import { trackEvent } from "@/lib/utils/track-event";
import { runAfter } from "@/lib/utils/run-after";
import { activeTeamIdsInHunt, teamModeOf } from "../../../teams/team-rules";
import { canAccessHunt } from "@/lib/hunts/review";
import { internalError } from "@/lib/utils/internal-error";
import {
  orderIndexFor,
  readClueDelivery,
  readClueOrders,
  sessionDeliveryMetadata,
  type ClueDelivery,
} from "@/lib/play/clue-delivery";
import { fullDeliveryMetadata } from "@/lib/hunts/clue-orders-store";
import { readNavigationHelp, sessionNavigationHelpMetadata, type NavigationHelp } from "@/lib/play/navigation-help";
import {
  HUNT_ENDED_MESSAGE,
  formatInZone,
  huntPhase,
  readHuntWindow,
  readScheduleTimeZone,
  type HuntWindowSource,
} from "@/lib/hunts/schedule";

const PLAYABLE_STATUSES = ["published", "enrollment_open", "in_progress"];
const ROUTE = "/api/v1/play/[huntId]/start";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  const blocked = await botGuard(request);
  if (blocked) return blocked;

  const start = performance.now();
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    runAfter("track_play_start", () =>
      trackEvent({ userId: user.id, eventType: "play_start", payload: { hunt_id: huntId } })
    );

    logger.info("play.start", { path: `/api/v1/play/${huntId}/start`, userId: user.id });

    const supabase = await createSupabaseServiceClient();

    // Check hunt exists and is playable
    const { data: hunt } = await supabase
      .from("hunts")
      .select("id, status, identity_mode, created_by, play_mode, review_status, metadata, starts_at, ends_at")
      .eq("id", huntId)
      .maybeSingle();

    if (!hunt || !PLAYABLE_STATUSES.includes(hunt.status)) {
      // Preview play of an unpublished hunt is deliberately NOT allowed here:
      // the answer/complete routes pick up any active session and write real
      // points, referral shares, streaks, badges and study events for it, and
      // nothing downstream can yet tell a preview session from a real one.
      // The owner gets told why instead of a bare "not found".
      const canManage =
        !!hunt && (hunt.created_by === user.id || ["admin", "researcher"].includes(user.role));
      if (canManage) {
        throw new ApiError(
          409,
          "This hunt isn't published yet, so it can't be played. Publish it first to try it out."
        );
      }
      throw new ApiError(404, "Hunt not found or not available");
    }

    // Published but not yet approved for the public catalogue: only the
    // creator, reviewers, and the creator's roster students may play it.
    if (!(await canAccessHunt(supabase, hunt, user))) {
      throw new ApiError(404, "Hunt not found or not available");
    }

    // Check for existing active session
    const { data: existing } = await supabase
      .from("play_sessions")
      .select("id, codename, metadata")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    // Clue delivery is locked once a hunt is published, so the mode and the
    // player's order group (assigned orders) are fixed for every session.
    const delivery = deliveryFor(await fullDeliveryMetadata(supabase, hunt, ROUTE), huntId, user.id);

    if (existing) {
      return Response.json({
        session: existing,
        resumed: true,
        identity_mode: hunt.identity_mode,
        ...playerDelivery(delivery, existing.metadata),
      });
    }

    // Scheduled hunts (issue #14): one window for everyone. A player can join
    // at any point while it is open, not before and not after. Someone who
    // already has a session (above) can always get back into it.
    const window = readHuntWindow(hunt as HuntWindowSource);
    const phase = huntPhase(window, Date.now());
    if (window && phase === "upcoming") {
      const zone = readScheduleTimeZone(hunt.metadata as Record<string, unknown> | null);
      throw new ApiError(409, `This hunt starts ${formatInZone(window.startsAtMs, zone)}. Come back then to play.`);
    }
    if (phase === "ended") throw new ApiError(409, HUNT_ENDED_MESSAGE);

    const body = await request.json().catch(() => ({}));

    // Determine codename based on hunt identity_mode
    let codename: string | null = null;

    if (hunt.identity_mode === "codename_assigned") {
      const { data: result } = await supabase.rpc("assign_random_codename", {
        p_hunt_id: huntId,
      });
      codename = result as string;
    } else if (hunt.identity_mode === "codename_chosen") {
      codename =
        typeof body.codename === "string" ? body.codename.trim().slice(0, 40) || null : null;
      if (!codename && body.assign_codename === true) {
        // Player asked us to pick a name for them
        const { data: result } = await supabase.rpc("assign_random_codename", {
          p_hunt_id: huntId,
        });
        codename = (result as string) || null;
      } else if (codename) {
        // Taken by someone else? (A replaying player may reuse their own name.)
        const { data: dups } = await supabase
          .from("play_sessions")
          .select("id")
          .eq("hunt_id", huntId)
          .eq("codename", codename)
          .neq("user_id", user.id)
          .limit(1);
        if (dups && dups.length > 0) {
          throw new ApiError(
            409,
            "That explorer name is already taken in this hunt. Try another!"
          );
        }
      }
      if (!codename) {
        // `needs_codename` tells the play page to show the name prompt
        return Response.json(
          {
            error: "Please choose an explorer name for this hunt",
            needs_codename: true,
            identity_mode: hunt.identity_mode,
          },
          { status: 400 }
        );
      }
    }

    // On team hunts the session belongs to the team the player is on. The
    // team comes from their membership, never from the request body.
    let teamId: string | null = null;
    if (teamModeOf(hunt.play_mode) !== "solo") {
      const teamIds = await activeTeamIdsInHunt(supabase, user.id, huntId);
      teamId = teamIds[0] ?? null;
      const canManage =
        hunt.created_by === user.id || ["admin", "researcher"].includes(user.role);
      if (!teamId && !canManage) {
        throw new ApiError(
          409,
          teamModeOf(hunt.play_mode) === "self_select"
            ? "This is a team hunt. Join or create a team on the hunt page before you start."
            : "This is a team hunt and you haven't been assigned to a team yet. Ask your teacher."
        );
      }
    }

    const { data: session, error } = await supabase
      .from("play_sessions")
      .insert({
        hunt_id: huntId,
        user_id: user.id,
        team_id: teamId,
        codename,
        // Recorded for researchers: the mode and, for assigned orders, the
        // group; and the hunt's difficulty (navigation help level).
        metadata: {
          ...sessionDeliveryMetadata(delivery.mode, delivery.orderIndex),
          ...sessionNavigationHelpMetadata(delivery.navigationHelp),
        },
      })
      .select()
      .single();

    if (error) {
      // Two start requests raced (double tap, or the page mounting twice) and
      // the other one created the active session first: resume that one.
      if (error.code === "23505") {
        const { data: raced } = await supabase
          .from("play_sessions")
          .select("id, codename")
          .eq("hunt_id", huntId)
          .eq("user_id", user.id)
          .eq("status", "active")
          .maybeSingle();
        if (raced) {
          return Response.json({
            session: raced,
            resumed: true,
            identity_mode: hunt.identity_mode,
            ...playerDelivery(delivery, null),
          });
        }
      }
      throw internalError("/api/v1/play/[huntId]/start", error);
    }

    logger.info("play.started", { userId: user.id, huntId, durationMs: Math.round(performance.now() - start) });

    return Response.json(
      {
        session,
        resumed: false,
        identity_mode: hunt.identity_mode,
        ...playerDelivery(delivery, null),
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error("play.start.error", { durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error);
  }
}

interface Delivery {
  mode: ClueDelivery;
  orders: string[][];
  orderIndex: number | null;
  assignment: { userId: string; huntId: string; orderCount: number };
  /** How much navigation help the hunt gives (lib/play/navigation-help). */
  navigationHelp: NavigationHelp;
}

/** The hunt's clue delivery mode and this player's assigned order group. */
function deliveryFor(huntMetadata: Record<string, unknown> | null, huntId: string, userId: string): Delivery {
  const mode = readClueDelivery(huntMetadata);
  const orders = readClueOrders(huntMetadata);
  const assignment = { userId, huntId, orderCount: orders.length };
  const orderIndex = mode === "assigned_order" && orders.length > 0 ? orderIndexFor(null, assignment) : null;
  return { mode, orders, orderIndex, assignment, navigationHelp: readNavigationHelp(huntMetadata) };
}

/**
 * What the player is told: the mode and, for assigned orders, their own group
 * and its order (the hunt's other orders never leave the server), and the
 * hunt's difficulty.
 */
function playerDelivery(delivery: Delivery, sessionMetadata: Record<string, unknown> | null) {
  const orderIndex = delivery.orderIndex === null ? null : orderIndexFor(sessionMetadata, delivery.assignment);
  return {
    clue_delivery: delivery.mode,
    clue_order_index: orderIndex,
    clue_order: orderIndex === null ? null : delivery.orders[orderIndex] ?? null,
    navigation_help: delivery.navigationHelp,
  };
}
