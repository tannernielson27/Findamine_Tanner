/**
 * What POST /api/v1/media/upload may store, where, and for whom.
 *
 * The route used to take a caller-chosen bucket and always return a public
 * URL, including for avatars and captures. Each upload now names a purpose;
 * the purpose fixes the bucket, who may upload, the accepted types and size,
 * and whether the result is served by public URL or a short-lived signed URL.
 * The object path is always `<caller users.id>/<random id>.<ext>` with the
 * extension taken from the MIME type, never from the client's file name.
 *
 * Personal buckets that other routes own (geo-selfies, challenge-audio) are
 * deliberately not reachable here.
 *
 * Pure: no I/O, unit tested directly.
 */

export type UploadPurpose = "hunt_media" | "avatar" | "capture";

export interface UploadPolicy {
  bucket: string;
  /**
   * true only where every object is meant to be world-readable. hunt-media is
   * hunt content (images, audio, video) shown to every player of a hunt.
   */
  publicRead: boolean;
  /** Roles allowed to upload for this purpose. */
  roles: readonly string[];
  /** MIME type -> stored file extension. */
  types: Readonly<Record<string, string>>;
  maxBytes: number;
}

const IMAGE_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
} as const;

const AUDIO_TYPES = {
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/webm": "webm",
} as const;

const VIDEO_TYPES = {
  "video/mp4": "mp4",
  "video/webm": "webm",
} as const;

/** Everyone who signs up themselves. Children (COPPA) never upload media. */
const NON_CHILD_ROLES = ["teen", "adult", "parent", "teacher", "hunt_creator", "admin", "researcher"] as const;
/** Roles that may create hunts (matches POST /api/v1/hunts). */
export const HUNT_MEDIA_ROLES = ["teacher", "hunt_creator", "admin", "researcher"] as const;
/** Roles that may attach media to a hunt they did not create. */
export const HUNT_MEDIA_STAFF_ROLES = ["admin", "researcher"] as const;

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
/** Lifetime of a signed URL returned for a private bucket. */
export const SIGNED_URL_SECONDS = 60 * 60;

export const UPLOAD_POLICIES: Readonly<Record<UploadPurpose, UploadPolicy>> = {
  hunt_media: {
    bucket: "hunt-media",
    publicRead: true,
    roles: HUNT_MEDIA_ROLES,
    types: { ...IMAGE_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES },
    maxBytes: MAX_UPLOAD_BYTES,
  },
  avatar: {
    bucket: "avatars",
    // Avatars are a profile field with per-viewer visibility, so not public.
    publicRead: false,
    roles: NON_CHILD_ROLES,
    types: IMAGE_TYPES,
    maxBytes: MAX_UPLOAD_BYTES,
  },
  capture: {
    bucket: "captures",
    publicRead: false,
    roles: NON_CHILD_ROLES,
    types: { ...IMAGE_TYPES, ...AUDIO_TYPES, ...VIDEO_TYPES },
    maxBytes: MAX_UPLOAD_BYTES,
  },
};

/** Legacy `bucket` form values still accepted, mapped to their purpose. */
const LEGACY_BUCKETS: Readonly<Record<string, UploadPurpose>> = {
  "hunt-media": "hunt_media",
  avatars: "avatar",
  captures: "capture",
};

export type Resolved<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

/**
 * The purpose from the form's `purpose` (preferred) or legacy `bucket` field.
 * Neither given means hunt media, the route's historical default.
 */
export function resolvePurpose(purpose: unknown, bucket: unknown): Resolved<UploadPurpose> {
  const p = typeof purpose === "string" ? purpose.trim() : "";
  const b = typeof bucket === "string" ? bucket.trim() : "";

  if (p) {
    if (!Object.prototype.hasOwnProperty.call(UPLOAD_POLICIES, p)) {
      return { ok: false, status: 400, message: "Invalid upload purpose" };
    }
    const fromPurpose = p as UploadPurpose;
    if (b && LEGACY_BUCKETS[b] !== fromPurpose) {
      return { ok: false, status: 400, message: "Invalid storage bucket" };
    }
    return { ok: true, value: fromPurpose };
  }
  if (b) {
    const fromBucket = Object.prototype.hasOwnProperty.call(LEGACY_BUCKETS, b) ? LEGACY_BUCKETS[b] : undefined;
    return fromBucket
      ? { ok: true, value: fromBucket }
      : { ok: false, status: 400, message: "Invalid storage bucket" };
  }
  return { ok: true, value: "hunt_media" };
}

export interface FileFacts {
  type: string;
  size: number;
}

/** Role, type and size checks. Returns the stored extension. */
export function checkUpload(policy: UploadPolicy, role: string | null | undefined, file: FileFacts): Resolved<string> {
  if (!role || !policy.roles.includes(role)) {
    return { ok: false, status: 403, message: "You can't upload this kind of file." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, status: 400, message: "The file is empty" };
  }
  if (file.size > policy.maxBytes) {
    return { ok: false, status: 400, message: `File too large (max ${Math.round(policy.maxBytes / (1024 * 1024))}MB)` };
  }
  const ext = Object.prototype.hasOwnProperty.call(policy.types, file.type) ? policy.types[file.type] : undefined;
  if (!ext) {
    return { ok: false, status: 400, message: `File type not allowed. Accepted: ${Object.keys(policy.types).join(", ")}` };
  }
  return { ok: true, value: ext };
}

/** `<userId>/<objectId>.<ext>`: always inside the caller's own folder. */
export function buildObjectPath(userId: string, objectId: string, ext: string): string {
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin";
  const safeId = objectId.replace(/[^A-Za-z0-9-]/g, "");
  return `${userId}/${safeId}.${safeExt}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTITY_TYPE_RE = /^[a-z_]{1,40}$/;

export interface EntityRef {
  entityType: string | null;
  entityId: string | null;
}

/** Optional entity link: both or neither, a short snake_case type and a UUID. */
export function parseEntityRef(entityType: unknown, entityId: unknown): Resolved<EntityRef> {
  const type = typeof entityType === "string" && entityType.trim() ? entityType.trim() : null;
  const id = typeof entityId === "string" && entityId.trim() ? entityId.trim() : null;
  if (!type && !id) return { ok: true, value: { entityType: null, entityId: null } };
  if (!type || !id || !ENTITY_TYPE_RE.test(type) || !UUID_RE.test(id)) {
    return { ok: false, status: 400, message: "Invalid entity_type or entity_id" };
  }
  return { ok: true, value: { entityType: type, entityId: id } };
}

/** A display-safe copy of the client's file name for the media row. */
export function cleanFilename(name: unknown): string {
  const raw = typeof name === "string" ? name : "";
  const base = raw.split(/[\\/]/).pop() ?? "";
  // Drop control characters, keep the rest readable.
  const cleaned = Array.from(base)
    .filter((ch) => ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) !== 127)
    .join("")
    .trim()
    .slice(0, 200);
  return cleaned || "upload";
}
