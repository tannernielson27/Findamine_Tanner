import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { playLimiter, uploadLimiter } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/utils/logger";
import { getCompletion } from "../../_lib/completions";
import { writeAudit } from "@/app/api/v1/admin/_lib/audit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  ALLOWED_AUDIO_TYPES,
  AUDIO_BUCKET,
  AUDIO_SIGNED_URL_SECONDS,
  LOCAL_AUDIO_REF,
  MAX_AUDIO_BYTES,
  audioStoragePath,
  baseMimeType,
  formatAudioAnswer,
  isAcceptableDuration,
  isAllowedAudioType,
  matchesAudioContainer,
  parseAudioAnswer,
} from "@/lib/play/audio-answer";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * POST: store a spoken answer for an audio_response challenge.
 *
 * Form fields: file (the MediaRecorder blob), find_id, duration_seconds.
 * Returns `answer`, the string the client then submits to /answer.
 *
 * Children's recordings are never stored (COPPA: a child's voice is personal
 * information). The client does not send them at all; if one arrives anyway
 * it is discarded and the answer says the recording stayed on the device.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await uploadLimiter.check(request, user.id);

    const formData = await request.formData();
    const findId = formData.get("find_id");
    const duration = Number(formData.get("duration_seconds"));
    const file = formData.get("file");

    if (typeof findId !== "string" || !findId) throw new ApiError(400, "find_id required");
    if (!isAcceptableDuration(duration)) {
      throw new ApiError(400, "Recording must be between 1 second and 2 minutes");
    }

    const supabase = await createSupabaseServiceClient();
    const completion = await openAudioChallenge(supabase, huntId, user.id, findId);

    if (user.role === "child") {
      return Response.json(
        { answer: formatAudioAnswer(duration, LOCAL_AUDIO_REF), local_only: true },
        { status: 201 }
      );
    }

    if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "No recording provided");
    if (file.size > MAX_AUDIO_BYTES) throw new ApiError(413, "Recording too large (max 4MB)");
    if (!isAllowedAudioType(file.type)) {
      throw new ApiError(400, `Audio type not allowed. Accepted: ${ALLOWED_AUDIO_TYPES.join(", ")}`);
    }
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    if (!matchesAudioContainer(file.type, head)) {
      throw new ApiError(400, "That file is not a valid recording");
    }

    // Only the latest take for a stop is kept: drop earlier, unsubmitted ones.
    await removeEarlierTakes(supabase, user.id, completion.id);

    const contentType = baseMimeType(file.type);
    const path = audioStoragePath(user.id, completion.id, contentType);
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .upload(path, file, { contentType, upsert: false });

    if (uploadError || !uploaded) {
      logger.error("play.audio.upload_failed", { userId: user.id, huntId, findId, error: uploadError?.message });
      throw new ApiError(502, "We couldn't save your recording. Please try again.");
    }

    return Response.json(
      { answer: formatAudioAnswer(duration, uploaded.path), local_only: false },
      { status: 201 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * GET ?find_id=...[&user_id=...]: a short-lived signed URL for a submitted
 * recording. Only the player who made it, or an admin (user_id names the
 * player), can get one. Nothing in the app grades or reviews audio yet, so no
 * one else needs it. An admin opening someone else's recording is written to
 * audit_log.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ huntId: string }> }
) {
  try {
    const { huntId } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await playLimiter.check(request, user.id);

    const findId = request.nextUrl.searchParams.get("find_id");
    if (!findId) throw new ApiError(400, "find_id required");
    const requested = request.nextUrl.searchParams.get("user_id");
    if (requested !== null && !UUID_RE.test(requested)) throw new ApiError(400, "user_id must be a UUID");
    const playerId = requested ?? user.id;
    if (playerId !== user.id && user.role !== "admin") throw new ApiError(403, "Not allowed");

    const supabase = await createSupabaseServiceClient();
    const { data: sessions, error: sessionError } = await supabase
      .from("play_sessions")
      .select("id")
      .eq("hunt_id", huntId)
      .eq("user_id", playerId)
      .order("started_at", { ascending: false })
      .limit(1);
    if (sessionError) {
      logger.error("play.audio.session_lookup_failed", { huntId, error: sessionError.message });
      throw new ApiError(500, "Couldn't load that recording. Please try again.");
    }
    const session = sessions?.[0];
    if (!session) throw new ApiError(404, "No recording found");

    const { data: rows, error: completionError } = await supabase
      .from("find_completions")
      .select("answer_value")
      .eq("play_session_id", session.id)
      .eq("find_id", findId);
    if (completionError) {
      logger.error("play.audio.completion_lookup_failed", { huntId, error: completionError.message });
      throw new ApiError(500, "Couldn't load that recording. Please try again.");
    }

    const path = (rows || [])
      .map((r) => parseAudioAnswer((r as { answer_value?: unknown }).answer_value)?.path)
      .find((p): p is string => !!p && p.startsWith(`${playerId}/`));
    if (!path) throw new ApiError(404, "No recording found");

    const { data: signed, error: signError } = await supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(path, AUDIO_SIGNED_URL_SECONDS);
    if (signError || !signed) throw new ApiError(404, "No recording found");

    if (playerId !== user.id) {
      // Someone else's voice: keep a record of which admin listened, and when.
      logger.info("play.audio.admin_access", { adminId: user.id, playerId, huntId, findId });
      await writeAudit(supabase, {
        user_id: user.id,
        action: "update",
        entity_type: "challenge_audio",
        entity_id: playerId,
        new_values: { op: "signed_url_issued", hunt_id: huntId, find_id: findId },
      });
    }

    return Response.json(
      { url: signed.signedUrl, expires_in: AUDIO_SIGNED_URL_SECONDS },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** The arrived, not-yet-completed audio stop this player is answering. */
async function openAudioChallenge(supabase: Db, huntId: string, userId: string, findId: string) {
  const { data: session } = await supabase
    .from("play_sessions")
    .select("id")
    .eq("hunt_id", huntId)
    .eq("user_id", userId)
    .eq("status", "active")
    .single();
  if (!session) throw new ApiError(404, "No active play session");

  const { data: find } = await supabase
    .from("finds")
    .select("hunt_id, tasks(challenge_type)")
    .eq("id", findId)
    .single();
  const task = find?.tasks as unknown as { challenge_type?: string } | null;
  if (!find || find.hunt_id !== huntId || task?.challenge_type !== "audio_response") {
    throw new ApiError(400, "This stop does not take a spoken answer");
  }

  const completion = await getCompletion(supabase, session.id, findId);
  if (!completion?.arrived_at) throw new ApiError(400, "Must arrive at location first");
  if (completion.completed_at) throw new ApiError(409, "Already completed this find");
  return completion;
}

async function removeEarlierTakes(supabase: Db, userId: string, completionId: string): Promise<void> {
  const { data } = await supabase.storage.from(AUDIO_BUCKET).list(userId, { search: `${completionId}_` });
  const stale = (data || [])
    .filter((f) => f.name.startsWith(`${completionId}_`))
    .map((f) => `${userId}/${f.name}`);
  if (stale.length === 0) return;
  const { error } = await supabase.storage.from(AUDIO_BUCKET).remove(stale);
  // Not fatal: account deletion sweeps the whole folder anyway.
  if (error) logger.warn("play.audio.cleanup_failed", { userId, count: stale.length, error: error.message });
}

export const maxDuration = 30;
