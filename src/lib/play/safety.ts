/**
 * Player safety copy and acknowledgement logic for location play.
 *
 * Findamine sends players walking to real places, so before their first hunt
 * every player sees a short safety notice and taps "I understand". The
 * acknowledgement is stored server-side in users.metadata (merged by
 * PUT /api/v1/auth/profile) with localStorage as the fast path. Bump
 * SAFETY_NOTICE_VERSION when the tips change materially so everyone sees the
 * new version once.
 */

export const SAFETY_NOTICE_VERSION = 1;

/** users.metadata key holding the acknowledged notice version. */
export const SAFETY_ACK_META_KEY = "safety_notice_ack_version";
/** users.metadata key holding when the notice was acknowledged. */
export const SAFETY_ACK_AT_META_KEY = "safety_notice_ack_at";

/** Longest stop-level safety note a creator can write. */
export const MAX_SAFETY_NOTES_LENGTH = 500;

export interface SafetyTip {
  id: string;
  text: string;
}

/** Short, friendly, age-appropriate tips. Shared by the notice and the hunt page. */
export const SAFETY_TIPS: readonly SafetyTip[] = [
  { id: "aware", text: "Look up from your screen. Watch for cars, bikes, curbs and other people." },
  { id: "moving", text: "Never play while driving, biking or skating. Stop somewhere safe first." },
  { id: "property", text: "Stay on public paths. Don't go onto private property or into closed or restricted areas." },
  { id: "rules", text: "Follow local laws and your school or campus rules." },
  { id: "daylight", text: "Play in daylight, and bring a buddy when you can." },
  { id: "kids", text: "Kids: play with a parent, teacher or another adult you trust." },
];

/** The one-line reminder shown while a player is walking to a stop. */
export const SAFETY_REMINDER = "Watch where you're walking. Stop to look at your screen.";

/** Whether a user's metadata records an acknowledgement of the current notice. */
export function isSafetyAcknowledged(
  metadata: Record<string, unknown> | null | undefined,
  version: number = SAFETY_NOTICE_VERSION
): boolean {
  const acked = metadata?.[SAFETY_ACK_META_KEY];
  return typeof acked === "number" && acked >= version;
}

/** Per-user localStorage key, so a shared device still shows the notice to each new player. */
export function safetyAckStorageKey(userId: string | null | undefined): string {
  return `findamine:safety-ack:v${SAFETY_NOTICE_VERSION}:${userId || "anon"}`;
}

/** Metadata patch recording an acknowledgement now. */
export function safetyAckMetadata(now: Date = new Date()): Record<string, unknown> {
  return {
    [SAFETY_ACK_META_KEY]: SAFETY_NOTICE_VERSION,
    [SAFETY_ACK_AT_META_KEY]: now.toISOString(),
  };
}

/** Normalize a creator-written stop safety note: trimmed, capped, or null when empty. */
export function normalizeSafetyNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_SAFETY_NOTES_LENGTH).trim();
  return trimmed || null;
}
