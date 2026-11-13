import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import { coordinatesForStorage } from "@/lib/utils/location-storage";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** The uploaded file, if the form carried a non-empty image. */
export function photoFromForm(value: FormDataEntryValue | null): File | null {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.type && !value.type.startsWith("image/")) throw new ApiError(400, "That file isn't a photo");
  if (value.size > MAX_PHOTO_BYTES) throw new ApiError(400, "Photo too large (max 10MB)");
  return value;
}

/**
 * Puts a stop photo in the private `geo-selfies` bucket (migration 070) and
 * returns its path. Under-13 accounts (COPPA): nothing is uploaded, ever.
 */
export async function uploadFindPhoto(
  supabase: SupabaseClient,
  input: { userId: string; role: string | null | undefined; findId: string; file: File | null },
  route: string
): Promise<string | null> {
  if (input.role === "child" || !input.file) return null;
  const ext = input.file.name.split(".").pop() || "jpg";
  const path = `${input.userId}/${input.findId}_${Date.now()}.${ext}`;
  const { data, error } = await supabase.storage
    .from("geo-selfies")
    .upload(path, input.file, { contentType: input.file.type });
  if (error) throw internalError(route, error);
  return data.path;
}

export interface PhotoRowInput {
  userId: string;
  role: string | null | undefined;
  completionId: string;
  storageRef: string | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Records a stop photo. For a child only the fact that a photo was taken is
 * kept (local_only, no coordinates); the image stays on the device.
 */
export async function insertFindPhotoRow(
  supabase: SupabaseClient,
  input: PhotoRowInput,
  route: string
): Promise<Record<string, unknown> & { id: string }> {
  const coords = coordinatesForStorage(input.role, input.latitude, input.longitude);
  const { data: photo, error } = await supabase
    .from("find_photos")
    .insert({
      completion_id: input.completionId,
      storage_ref: input.role === "child" ? null : input.storageRef,
      local_only: input.role === "child",
      caption: input.caption || null,
      latitude: coords.latitude,
      longitude: coords.longitude,
      uploaded_by: input.userId,
    })
    .select()
    .single();
  if (error || !photo) throw internalError(route, error ?? new Error("photo insert returned nothing"));
  return photo as Record<string, unknown> & { id: string };
}
