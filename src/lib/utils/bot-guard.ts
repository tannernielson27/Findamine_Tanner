/**
 * Bot guard — call at the top of API routes to detect and reject bots.
 *
 * Usage in a route handler:
 *   const blocked = await botGuard(request);
 *   if (blocked) return blocked;
 */

import { NextRequest } from "next/server";
import { detectBot, getIpHash, isIpBlocked } from "./bot-detector";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

/**
 * Returns a 403 Response if the request is from a blocked IP or
 * a definite bot. Returns null if the request is OK.
 */
export async function botGuard(request: NextRequest): Promise<Response | null> {
  const ipHash = getIpHash(request);

  // Check if already blocked
  if (await isIpBlocked(ipHash)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Score the request
  const result = detectBot(request);

  // Reject definite bots (100% confidence), but only this request. The IP is
  // deliberately not blocked: a whole class can share one campus address, so
  // one scripted request would lock everyone out. Persistent blocks are left
  // to admins.
  if (result.definite) {
    // Log the event
    try {
      const supabase = await createSupabaseServiceClient();
      await supabase.from("behavioral_events").insert({
        event_type: "bot_blocked",
        event_name: "Rejected bot traffic",
        payload: {
          ip_hash: ipHash,
          score: result.score,
          reasons: result.reasons,
          user_agent: request.headers.get("user-agent"),
          path: new URL(request.url).pathname,
        },
      });
    } catch {
      // Don't fail the guard if logging fails
    }

    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Log suspicious activity (score >= 50) but don't block
  if (result.score >= 50) {
    try {
      const supabase = await createSupabaseServiceClient();
      await supabase.from("behavioral_events").insert({
        event_type: "bot_suspicious",
        event_name: "Suspicious traffic detected",
        payload: {
          ip_hash: ipHash,
          score: result.score,
          classification: result.classification,
          reasons: result.reasons,
          user_agent: request.headers.get("user-agent"),
          path: new URL(request.url).pathname,
        },
      });
    } catch {
      // Don't fail if logging fails
    }
  }

  return null; // Request is OK
}
