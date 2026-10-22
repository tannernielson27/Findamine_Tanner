/**
 * Hunt cover photos (migration 079): what POST /api/v1/hunts/[id]/cover
 * accepts and where it stores it.
 *
 * The file's type is decided from its first bytes, never from the client's
 * Content-Type or file name. Objects live at `<hunt id>/<random id>.<ext>` in
 * the public `hunt-covers` bucket, so the storage policies can tie each
 * object to its hunt.
 *
 * Pure: no I/O, unit tested directly.
 */

export const COVER_BUCKET = "hunt-covers";
export const COVER_MAX_BYTES = 5 * 1024 * 1024;

/** Roles that may set a cover (matches PUT /api/v1/hunts/[id]). */
export const COVER_EDITOR_ROLES = ["teacher", "hunt_creator", "admin", "researcher"] as const;
/** Roles that may change the cover of a hunt they did not create. */
export const COVER_STAFF_ROLES = ["admin", "researcher"] as const;

export type CoverMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

export const COVER_EXTENSIONS: Readonly<Record<CoverMime, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

/** ISO-BMFF brands that mean an HEIC (HEVC-coded) image. */
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"]);
/** Generic HEIF brands. */
const HEIF_BRANDS = new Set(["mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, length: number): string {
  if (bytes.length < start + length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

/** The image type the bytes actually are, or null when they are none we accept. */
export function sniffCoverType(bytes: Uint8Array): CoverMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= PNG.length && PNG.every((b, i) => bytes[i] === b)) return "image/png";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (HEIC_BRANDS.has(brand)) return "image/heic";
    if (HEIF_BRANDS.has(brand)) return "image/heif";
  }
  return null;
}

export type CoverCheck =
  | { ok: true; mime: CoverMime; ext: string }
  | { ok: false; status: number; message: string };

const ACCEPTED_LABEL = "JPEG, PNG, WebP or HEIC";

/** Size and content checks for an uploaded cover. */
export function checkCoverFile(size: number, head: Uint8Array): CoverCheck {
  if (!Number.isFinite(size) || size <= 0) return { ok: false, status: 400, message: "The file is empty." };
  if (size > COVER_MAX_BYTES) {
    return { ok: false, status: 413, message: "That photo is too large. The limit is 5 MB." };
  }
  const mime = sniffCoverType(head);
  if (!mime) {
    return { ok: false, status: 415, message: `That file isn't a supported image. Use a ${ACCEPTED_LABEL} photo.` };
  }
  return { ok: true, mime, ext: COVER_EXTENSIONS[mime] };
}

/** Whether `role` may change the cover of a hunt created by `createdBy`. */
export function canEditCover(user: { id: string; role: string }, createdBy: string | null | undefined): boolean {
  if ((COVER_STAFF_ROLES as readonly string[]).includes(user.role)) return true;
  return !!createdBy && createdBy === user.id && (COVER_EDITOR_ROLES as readonly string[]).includes(user.role);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** `<huntId>/<objectId>.<ext>`: always inside the hunt's own folder. */
export function buildCoverPath(huntId: string, objectId: string, ext: string): string {
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : "bin";
  const safeId = objectId.replace(/[^A-Za-z0-9-]/g, "");
  return `${huntId}/${safeId}.${safeExt}`;
}

/**
 * The object path inside `hunt-covers` for a stored cover URL, when the URL
 * points at this hunt's folder in that bucket. Anything else (another hunt's
 * folder, another bucket, a foreign host's path) gives null, so the route
 * never deletes an object it does not own.
 */
export function coverObjectPathFromUrl(url: string | null | undefined, huntId: string): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${COVER_BUCKET}/`;
  let path: string;
  try {
    const pathname = new URL(url).pathname;
    const at = pathname.indexOf(marker);
    if (at === -1) return null;
    path = decodeURIComponent(pathname.slice(at + marker.length));
  } catch {
    return null;
  }
  const [folder, file, ...rest] = path.split("/");
  if (rest.length > 0 || folder !== huntId || !file || !/^[A-Za-z0-9-]+\.[a-z0-9]{1,5}$/.test(file)) return null;
  return path;
}
