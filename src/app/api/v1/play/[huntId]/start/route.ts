import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { logger } from "@/lib/utils/logger";
import { botGuard } from "@/lib/utils/bot-guard";
import { trackEvent } from "@/lib/utils/track-event";

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

    trackEvent({ userId: user.id, eventType: "play_start", payload: { hunt_id: huntId } });

    logger.info("play.start", { path: `/api/v1/play/${huntId}/start`, userId: user.id });

    const supabase = await createSupabaseServiceClient();

    // Check hunt exists and is playable
    const { data: hunt } = await supabase
      .from("hunts")
      .select("id, status, identity_mode")
      .eq("id", huntId)
      .in("status", ["published", "enrollment_open", "in_progress"])
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found or not available");

    // Check for existing active session
    const { data: existing } = await supabase
      .from("play_sessions")
      .select("id, codename")
      .eq("hunt_id", huntId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (existing) {
      return Response.json({
        session: existing,
        resumed: true,
        identity_mode: hunt.identity_mode,
      });
    }

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

    const { data: session, error } = await supabase
      .from("play_sessions")
      .insert({
        hunt_id: huntId,
        user_id: user.id,
        team_id: body.team_id || null,
        codename,
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
          });
        }
      }
      throw new ApiError(500, error.message);
    }

    logger.info("play.started", { userId: user.id, huntId, durationMs: Math.round(performance.now() - start) });

    return Response.json(
      { session, resumed: false, identity_mode: hunt.identity_mode },
      { status: 201 }
    );
  } catch (error) {
    logger.error("play.start.error", { durationMs: Math.round(performance.now() - start), error: error instanceof Error ? error.message : String(error) });
    return errorResponse(error);
  }
}
