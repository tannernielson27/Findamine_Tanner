import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import { coordinatesForStorage } from "@/lib/utils/location-storage";

export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface StorePhotoInput {
  userId: string;
  role: string | null | undefined;
  completionId: string;
  findId: string;
  file: File | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface StoredPhoto {
  photo: Record<string, unknown> & { id: string };
  localOnly: boolean;
}

/**
 * Saves a stop photo. Under-13 accounts (COPPA): only the fact that a photo
 * was taken is recorded; the image and its location stay on the device.
 * Everyone else: the image goes to the private `geo-selfies` bucket.
 */
export async function storeFindPhoto(
  supabase: SupabaseClient,
  input: StorePhotoInput,
  route: string
): Promise<StoredPhoto> {
  const isChild = input.role === "child";
  const coords = coordinatesForStorage(input.role, input.latitude, input.longitude);
  let storageRef: string | null = null;

  if (!isChild && input.file) {
    if (input.file.size > MAX_PHOTO_BYTES) throw new ApiError(400, "Photo too large (max 10MB)");
    const ext = input.file.name.split(".").pop() || "jpg";
    const path = `${input.userId}/${input.findId}_${Date.now()}.${ext}`;
    // Private bucket (migration 070); only the path is stored.
    const { data, error } = await supabase.storage
      .from("geo-selfies")
      .upload(path, input.file, { contentType: input.file.type });
    if (error) throw internalError(route, error);
    storageRef = data.path;
  }

  const { data: photo, error } = await supabase
    .from("find_photos")
    .insert({
      completion_id: input.completionId,
      storage_ref: storageRef,
      local_only: isChild,
      caption: input.caption || null,
      latitude: coords.latitude,
      longitude: coords.longitude,
      uploaded_by: input.userId,
    })
    .select()
    .single();

  if (error || !photo) throw internalError(route, error ?? new Error("photo insert returned nothing"));
  return { photo: photo as StoredPhoto["photo"], localOnly: isChild };
}
