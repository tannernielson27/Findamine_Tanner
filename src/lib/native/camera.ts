/**
 * Native photo capture for the iOS app (@capacitor/camera + @capacitor/filesystem).
 *
 * The web build keeps `<input type="file" accept="image/*" capture>`; inside
 * the wrapper the camera and the photo picker are native, and the picked
 * image comes back as a File so the existing upload code is unchanged.
 *
 * The image is read through the Filesystem plugin as base64 rather than
 * fetched from its webPath: the app's pages are served from the remote site,
 * and a page on https:// can't fetch the wrapper's local capacitor:// file URL.
 */

export type PhotoSource = "camera" | "library";
export type PhotoErrorKind = "cancelled" | "denied" | "failed";

export class PhotoError extends Error {
  constructor(public readonly kind: PhotoErrorKind, message?: string) {
    super(message ?? `Photo ${kind}`);
    this.name = "PhotoError";
  }
}

/** Camera plugin error codes (README of @capacitor/camera, 8.1+ APIs). */
const CANCELLED_CODES = new Set(["OS-PLUG-CAMR-0006", "OS-PLUG-CAMR-0013", "OS-PLUG-CAMR-0020"]);
const DENIED_CODES = new Set(["OS-PLUG-CAMR-0003", "OS-PLUG-CAMR-0005"]);

/** Collapses a Camera plugin error to what the UI distinguishes. */
export function classifyPhotoError(err: unknown): PhotoErrorKind {
  if (err instanceof PhotoError) return err.kind;
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  if (typeof e.code === "string") {
    if (CANCELLED_CODES.has(e.code)) return "cancelled";
    if (DENIED_CODES.has(e.code)) return "denied";
  }
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (/cancel/.test(message)) return "cancelled";
  if (/denied|permission|access wasn't provided|not authori[sz]ed/.test(message)) return "denied";
  return "failed";
}

const MIME_BY_FORMAT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  heif: "image/heif",
  gif: "image/gif",
  webp: "image/webp",
};

/** MIME type for the plugin's `format` ("jpeg", "png", ...). Defaults to JPEG. */
export function mimeForFormat(format: string | null | undefined): string {
  const key = (format ?? "").toLowerCase().replace(/^image\//, "");
  return MIME_BY_FORMAT[key] ?? "image/jpeg";
}

/** Builds a File from base64 data (a bare string or a data: URL). */
export function base64ToFile(data: string, mime: string, name: string): File {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1;
  const b64 = comma >= 0 ? data.slice(comma + 1) : data;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

function fileName(mime: string): string {
  const ext = mime === "image/jpeg" ? "jpg" : mime.split("/")[1] || "jpg";
  return `photo-${Date.now()}.${ext}`;
}

/**
 * Opens the native camera (or photo picker) and returns the picked image.
 * Rejects with a PhotoError: "cancelled" when the person backs out.
 * Only call this inside the wrapper (isNativeApp()).
 */
export async function pickNativePhoto(source: PhotoSource): Promise<File> {
  try {
    const [{ Camera }, { Filesystem }] = await Promise.all([
      import("@capacitor/camera"),
      import("@capacitor/filesystem"),
    ]);
    // Downscaled JPEG: plenty for a geo-selfie, and well under upload limits.
    const common = { quality: 80, targetWidth: 1600, targetHeight: 1600, correctOrientation: true, editable: "no" as const };
    const media =
      source === "camera"
        ? await Camera.takePhoto({ ...common, saveToGallery: false })
        : (await Camera.chooseFromGallery({ ...common, allowMultipleSelection: false, limit: 1 })).results[0];
    if (!media?.uri) throw new PhotoError("cancelled");
    const read = await Filesystem.readFile({ path: media.uri });
    const mime = mimeForFormat(media.metadata?.format ?? "jpeg");
    if (typeof read.data !== "string") {
      return new File([read.data], fileName(mime), { type: read.data.type || mime });
    }
    return base64ToFile(read.data, mime, fileName(mime));
  } catch (err) {
    if (err instanceof PhotoError) throw err;
    throw new PhotoError(classifyPhotoError(err), err instanceof Error ? err.message : undefined);
  }
}
