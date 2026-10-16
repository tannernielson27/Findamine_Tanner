/**
 * What PUT /api/v1/auth/profile accepts as avatar_url.
 *
 * An avatar is uploaded through POST /api/v1/media/upload (purpose "avatar"),
 * which stores it at `<users.id>/<id>.<ext>` in the avatars bucket. The
 * profile may point only at such an object in the caller's own folder: as the
 * bare storage path, or as a URL into this project's Supabase Storage. Any
 * other value (another person's avatar, an outside tracker image, a
 * javascript: URL) is refused, because avatar_url is rendered for other
 * players.
 *
 * Pure: no I/O, unit tested directly.
 */

const AVATAR_BUCKET = "avatars";
const OBJECT_NAME_RE = /^[A-Za-z0-9-]{1,64}\.(?:jpg|jpeg|png|webp|gif)$/;
const STORAGE_OBJECT_PREFIX_RE = /^\/storage\/v1\/object\/(?:public|sign|authenticated)\//;

export type AvatarUrlResult = { ok: true; value: string | null } | { ok: false; message: string };

const REFUSED: AvatarUrlResult = {
  ok: false,
  message: "Upload a picture with the avatar uploader instead of linking one.",
};

/** `<userId>/<object>` with nothing else in it, or false. */
function isOwnObjectPath(path: string, userId: string): boolean {
  const [folder, name, ...rest] = path.split("/");
  return rest.length === 0 && folder === userId && !!name && OBJECT_NAME_RE.test(name);
}

export function parseAvatarUrl(
  value: unknown,
  userId: string,
  supabaseUrl: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL
): AvatarUrlResult {
  if (value === null || value === "") return { ok: true, value: null };
  if (typeof value !== "string" || value.length > 2048 || !userId) return REFUSED;
  const trimmed = value.trim();

  // A bare storage path, with or without the bucket name in front.
  if (!trimmed.includes("://")) {
    const path = trimmed.startsWith(`${AVATAR_BUCKET}/`) ? trimmed.slice(AVATAR_BUCKET.length + 1) : trimmed;
    return isOwnObjectPath(path, userId) ? { ok: true, value: trimmed } : REFUSED;
  }

  // A URL into this project's storage: public, signed or authenticated form.
  let url: URL;
  let storageOrigin: string;
  try {
    url = new URL(trimmed);
    storageOrigin = new URL(supabaseUrl ?? "").origin;
  } catch {
    return REFUSED;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return REFUSED;
  if (url.origin !== storageOrigin || url.username || url.password) return REFUSED;
  const prefix = STORAGE_OBJECT_PREFIX_RE.exec(url.pathname);
  if (!prefix) return REFUSED;
  let objectPath: string;
  try {
    objectPath = decodeURIComponent(url.pathname.slice(prefix[0].length));
  } catch {
    return REFUSED;
  }
  if (!objectPath.startsWith(`${AVATAR_BUCKET}/`)) return REFUSED;
  return isOwnObjectPath(objectPath.slice(AVATAR_BUCKET.length + 1), userId)
    ? { ok: true, value: url.toString() }
    : REFUSED;
}
