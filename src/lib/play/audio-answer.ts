/**
 * Spoken answers to audio_response challenges.
 *
 * Shared by the recorder (challenge-input.tsx), the upload route
 * (api/v1/play/[huntId]/audio) and the answer route, so the limits and the
 * answer format cannot drift apart.
 *
 * The answer a player submits is a reference, never the audio itself:
 *   [audio:12s:<user_id>/<completion_id>_<ms>.webm]   uploaded (teen/adult)
 *   [audio:12s:local]                                 kept on the device (child)
 */

/** Private bucket created by migration 075. */
export const AUDIO_BUCKET = "challenge-audio";

/** The recorder stops itself here. */
export const MAX_AUDIO_SECONDS = 120;
/** Clock skew between the client timer and the recorder. */
const DURATION_SLACK_SECONDS = 5;
/** Under Vercel's 4.5 MB request-body limit; 2 min of AAC at 128 kbps is ~2 MB. */
export const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
/** Lifetime of a signed playback URL. */
export const AUDIO_SIGNED_URL_SECONDS = 300;

/**
 * What MediaRecorder actually produces: Chrome/Edge/Android audio/webm,
 * Safari and iOS WKWebView audio/mp4, Firefox audio/ogg.
 */
const EXTENSION_FOR: Record<string, string> = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
};

export const ALLOWED_AUDIO_TYPES = Object.keys(EXTENSION_FOR);

/** "audio/webm;codecs=opus" → "audio/webm". */
export function baseMimeType(type: string | null | undefined): string {
  return (type || "").split(";")[0].trim().toLowerCase();
}

export function isAllowedAudioType(type: string | null | undefined): boolean {
  return baseMimeType(type) in EXTENSION_FOR;
}

export function audioExtension(type: string): string {
  return EXTENSION_FOR[baseMimeType(type)] ?? "bin";
}

/** Duration the server will accept (whole seconds, client-reported). */
export function isAcceptableDuration(seconds: number): boolean {
  return Number.isFinite(seconds) && seconds >= 1 && seconds <= MAX_AUDIO_SECONDS + DURATION_SLACK_SECONDS;
}

/**
 * Checks the container's magic bytes so a file labelled audio really is the
 * container it claims: WebM (EBML header), MP4 ("ftyp" box) or Ogg ("OggS").
 */
export function matchesAudioContainer(type: string, head: Uint8Array): boolean {
  const base = baseMimeType(type);
  if (base === "audio/webm") {
    return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }
  if (base === "audio/mp4" || base === "audio/x-m4a") {
    return head.length >= 8 && String.fromCharCode(head[4], head[5], head[6], head[7]) === "ftyp";
  }
  if (base === "audio/ogg") {
    return head.length >= 4 && String.fromCharCode(head[0], head[1], head[2], head[3]) === "OggS";
  }
  return false;
}

/** Storage path for one recording; always inside the owner's folder. */
export function audioStoragePath(userId: string, completionId: string, type: string, now: number = Date.now()): string {
  return `${userId}/${completionId}_${now}.${audioExtension(type)}`;
}

export const LOCAL_AUDIO_REF = "local";

export function formatAudioAnswer(seconds: number, ref: string): string {
  return `[audio:${Math.max(0, Math.round(seconds))}s:${ref}]`;
}

export interface ParsedAudioAnswer {
  seconds: number;
  /** Storage path, or null when the recording stayed on the device. */
  path: string | null;
}

const ANSWER_PATTERN = /^\[audio:(\d+)s:([^\]\s]+)\]$/;

export function parseAudioAnswer(answer: unknown): ParsedAudioAnswer | null {
  const match = typeof answer === "string" ? ANSWER_PATTERN.exec(answer.trim()) : null;
  if (!match) return null;
  const ref = match[2];
  return { seconds: Number(match[1]), path: ref === LOCAL_AUDIO_REF ? null : ref };
}

/**
 * True when `path` is a recording this player made for this stop:
 * `<userId>/<completionId>_<digits>.<allowed ext>` and nothing else.
 */
export function isOwnAudioPath(path: string, userId: string, completionId: string): boolean {
  const prefix = `${userId}/${completionId}_`;
  if (!path.startsWith(prefix)) return false;
  return /^\d+\.(webm|m4a|ogg)$/.test(path.slice(prefix.length));
}
