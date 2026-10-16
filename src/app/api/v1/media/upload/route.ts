import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { uploadLimiter } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/utils/logger";
import {
  HUNT_MEDIA_STAFF_ROLES,
  SIGNED_URL_SECONDS,
  UPLOAD_POLICIES,
  buildObjectPath,
  checkUpload,
  cleanFilename,
  parseEntityRef,
  resolvePurpose,
  type Resolved,
} from "@/lib/media/upload-policy";

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

function unwrap<T>(result: Resolved<T>): T {
  if (!result.ok) throw new ApiError(result.status, result.message);
  return result.value;
}

/** Hunt media may only be attached to a hunt the caller created (staff excepted). */
async function assertCanAttachToHunt(supabase: Db, huntId: string, userId: string, role: string): Promise<void> {
  if ((HUNT_MEDIA_STAFF_ROLES as readonly string[]).includes(role)) return;
  const { data, error } = await supabase.from("hunts").select("created_by").eq("id", huntId).maybeSingle();
  if (error) throw new ApiError(500, "Could not check the hunt");
  if (!data || (data as { created_by?: string }).created_by !== userId) {
    throw new ApiError(403, "You can only add media to your own hunts.");
  }
}

/**
 * POST /api/v1/media/upload (multipart): file, purpose (hunt_media | avatar |
 * capture; legacy `bucket` = hunt-media | avatars | captures still accepted),
 * optional entity_type + entity_id. See src/lib/media/upload-policy.ts.
 *
 * Response: { media: { ...row, url, url_expires_in } }. `url` is a public URL
 * for hunt media and a signed URL (url_expires_in seconds) otherwise; `path`
 * is the durable reference for private objects.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await uploadLimiter.check(request, user.id);

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "No file provided");

    const purpose = unwrap(resolvePurpose(formData.get("purpose"), formData.get("bucket")));
    const policy = UPLOAD_POLICIES[purpose];
    const ext = unwrap(checkUpload(policy, user.role, { type: file.type, size: file.size }));
    const { entityType, entityId } = unwrap(
      parseEntityRef(formData.get("entity_type"), formData.get("entity_id"))
    );

    const supabase = await createSupabaseServiceClient();
    if (purpose === "hunt_media" && entityType === "hunt" && entityId) {
      await assertCanAttachToHunt(supabase, entityId, user.id, user.role);
    }

    const path = buildObjectPath(user.id, randomUUID(), ext);
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from(policy.bucket)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError || !uploadData) {
      logger.error("media.upload.failed", { userId: user.id, bucket: policy.bucket, error: uploadError?.message });
      throw new ApiError(500, "Upload failed");
    }

    const { data: media, error: mediaError } = await supabase
      .from("media")
      .insert({
        bucket: policy.bucket,
        path: uploadData.path,
        filename: cleanFilename(file.name),
        content_type: file.type,
        size_bytes: file.size,
        entity_type: entityType,
        entity_id: entityId,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (mediaError || !media) {
      // Do not leave an orphaned object behind.
      await supabase.storage.from(policy.bucket).remove([uploadData.path]);
      logger.error("media.upload.record_failed", { userId: user.id, error: mediaError?.message });
      throw new ApiError(500, "Upload failed");
    }

    if (policy.publicRead) {
      const { data: { publicUrl } } = supabase.storage.from(policy.bucket).getPublicUrl(uploadData.path);
      return Response.json({ media: { ...media, url: publicUrl, url_expires_in: null } }, { status: 201 });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from(policy.bucket)
      .createSignedUrl(uploadData.path, SIGNED_URL_SECONDS);
    if (signError || !signed) {
      logger.error("media.upload.sign_failed", { userId: user.id, bucket: policy.bucket, error: signError?.message });
    }
    return Response.json(
      {
        media: {
          ...media,
          url: signed?.signedUrl ?? null,
          url_expires_in: signed ? SIGNED_URL_SECONDS : null,
        },
      },
      { status: 201, headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 30;
