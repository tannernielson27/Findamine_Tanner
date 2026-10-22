import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError, requireRole } from "@/lib/utils/api-auth";
import { assertTrustedOrigin } from "@/lib/utils/origin";
import { uploadLimiter } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/utils/logger";
import { requeuedMessage, settleRequeue } from "@/lib/hunts/review";
import {
  COVER_BUCKET,
  COVER_EDITOR_ROLES,
  COVER_MAX_BYTES,
  buildCoverPath,
  canEditCover,
  checkCoverFile,
  coverObjectPathFromUrl,
  isUuid,
} from "@/lib/hunts/cover-image";
import type { AuthUser } from "@/lib/types/database";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

interface CoverHunt {
  id: string;
  created_by: string;
  status: string;
  review_status: string | null;
  cover_image_url: string | null;
}

/** Room for the multipart envelope around a maximum-size file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
/** Bytes read to identify the file type. */
const SNIFF_BYTES = 32;

/** Origin, sign-in, role, rate limit, and owner/staff check shared by POST and DELETE. */
async function authorize(
  request: NextRequest,
  params: Promise<{ id: string }>
): Promise<{ user: AuthUser; supabase: Db; hunt: CoverHunt }> {
  assertTrustedOrigin(request);
  const { id } = await params;
  const user = await getAuthUser(request);
  requireRole(user, ...COVER_EDITOR_ROLES);
  await uploadLimiter.check(request, user.id);
  if (!isUuid(id)) throw new ApiError(404, "Hunt not found");

  const supabase = await createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("hunts")
    .select("id, created_by, status, review_status, cover_image_url")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    logger.error("hunt.cover.load_failed", { huntId: id, error: error.message });
    throw new ApiError(500, "Couldn't load the hunt. Please try again.");
  }
  const hunt = data as CoverHunt | null;
  if (!hunt) throw new ApiError(404, "Hunt not found");
  if (!canEditCover(user, hunt.created_by)) {
    throw new ApiError(403, "You can only change the cover of your own hunts.");
  }
  return { user, supabase, hunt };
}

/** Delete a replaced/cleared cover object. Never fails the request. */
async function removeOldCover(supabase: Db, hunt: CoverHunt): Promise<void> {
  const path = coverObjectPathFromUrl(hunt.cover_image_url, hunt.id);
  if (!path) return;
  const { error } = await supabase.storage.from(COVER_BUCKET).remove([path]);
  if (error) logger.warn("hunt.cover.remove_old_failed", { huntId: hunt.id, error: error.message });
}

/**
 * Same rule as PUT /api/v1/hunts/[id]: a reviewer approved the hunt as it
 * looked, so changing its cover on a listed hunt takes it out of Discover
 * until it is reviewed again. The hunts trigger enforces this (migration
 * 079); settleRequeue also requeues explicitly and reads the outcome.
 */
async function respond(
  supabase: Db,
  user: AuthUser,
  hunt: CoverHunt,
  coverImageUrl: string | null,
  status: number
): Promise<Response> {
  const wasListed = hunt.review_status === "approved" && hunt.status !== "draft";
  const requeued = await settleRequeue(supabase, hunt.id, wasListed, true);
  const data = requeued
    ? { cover_image_url: coverImageUrl, review_status: "pending", message: requeuedMessage(user.id, hunt.created_by) }
    : { cover_image_url: coverImageUrl };
  return Response.json({ data }, { status });
}

/**
 * POST /api/v1/hunts/[id]/cover (multipart, field `file`): set the hunt's
 * cover photo. JPEG, PNG, WebP or HEIC, identified by content, up to 4 MB.
 * Owner (teacher/hunt_creator) or admin/researcher only.
 *
 * Response 201: { data: { cover_image_url, review_status?, message? } }.
 * review_status/message appear when the change sent a listed hunt back to review.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, supabase, hunt } = await authorize(request, params);

    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > COVER_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new ApiError(413, "That photo is too large. The limit is 4 MB.");
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "No file provided");
    if (file.type && !file.type.startsWith("image/") && file.type !== "application/octet-stream") {
      throw new ApiError(415, "That file isn't a supported image. Use a JPEG, PNG, WebP or HEIC photo.");
    }
    if (file.size > COVER_MAX_BYTES) throw new ApiError(413, "That photo is too large. The limit is 4 MB.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkCoverFile(bytes.byteLength, bytes.subarray(0, SNIFF_BYTES));
    if (!check.ok) throw new ApiError(check.status, check.message);

    const path = buildCoverPath(hunt.id, randomUUID(), check.ext);
    const { data: uploaded, error: uploadError } = await supabase.storage
      .from(COVER_BUCKET)
      .upload(path, bytes, { contentType: check.mime, upsert: false, cacheControl: "31536000" });
    if (uploadError || !uploaded) {
      logger.error("hunt.cover.upload_failed", { huntId: hunt.id, userId: user.id, error: uploadError?.message });
      throw new ApiError(500, "Upload failed. Please try again.");
    }

    const { data: { publicUrl } } = supabase.storage.from(COVER_BUCKET).getPublicUrl(uploaded.path);
    const { error: updateError } = await supabase
      .from("hunts")
      .update({ cover_image_url: publicUrl })
      .eq("id", hunt.id);
    if (updateError) {
      // Do not leave an orphaned object behind.
      await supabase.storage.from(COVER_BUCKET).remove([uploaded.path]);
      logger.error("hunt.cover.save_failed", { huntId: hunt.id, userId: user.id, error: updateError.message });
      throw new ApiError(500, "Couldn't save the cover. Please try again.");
    }

    await removeOldCover(supabase, hunt);
    return respond(supabase, user, hunt, publicUrl, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

/** DELETE /api/v1/hunts/[id]/cover: clear the cover (back to generated art). */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { user, supabase, hunt } = await authorize(request, params);
    if (!hunt.cover_image_url) return Response.json({ data: { cover_image_url: null } });

    const { error } = await supabase.from("hunts").update({ cover_image_url: null }).eq("id", hunt.id);
    if (error) {
      logger.error("hunt.cover.clear_failed", { huntId: hunt.id, userId: user.id, error: error.message });
      throw new ApiError(500, "Couldn't remove the cover. Please try again.");
    }

    await removeOldCover(supabase, hunt);
    return respond(supabase, user, hunt, null, 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
