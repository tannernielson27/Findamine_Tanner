/**
 * Validation for client-logged behavioral events (POST /api/v1/events/batch).
 * Pure, so it is unit tested directly.
 */

export interface EventRow {
  user_id: string;
  session_id: string | null;
  event_type: string;
  event_name: string | null;
  payload: Record<string, unknown>;
  platform: string | null;
  app_version: string | null;
}

/**
 * The only types a client may log. Study events (referral payouts and
 * forfeits, forfeit-notice exposure, privacy events) are written server-side;
 * accepting them here would let a participant forge them.
 */
export const CLIENT_EVENT_TYPES: ReadonlySet<string> = new Set(["screen_view", "app_state", "client_error"]);

/** Envelope fields are short identifiers; anything else is dropped (no free text). */
const SAFE_TEXT = /^[\w:/.\- ()+]+$/;

function safeText(value: unknown, max: number): string | null {
  const text = shortText(value, max);
  return text && SAFE_TEXT.test(text) ? text : null;
}

const PLATFORMS = new Set(["ios", "android", "web"]);
const MAX_PAYLOAD_BYTES = 4096;

function shortText(value: unknown, max: number): string | null {
  return typeof value === "string" && value ? value.slice(0, max) : null;
}

/**
 * One validated behavioral_events row, or null if the event is malformed.
 * The client's own timestamp is kept in the payload (created_at is server time).
 */
export function toEventRow(userId: string, raw: unknown): EventRow | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  if (typeof e.event_type !== "string" || !CLIENT_EVENT_TYPES.has(e.event_type)) return null;
  const payload =
    e.payload && typeof e.payload === "object" && !Array.isArray(e.payload)
      ? { ...(e.payload as Record<string, unknown>) }
      : {};
  const clientTs = shortText(e.client_ts, 40);
  if (clientTs) payload.client_ts = clientTs;
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) return null;
  const platform = typeof e.platform === "string" && PLATFORMS.has(e.platform) ? e.platform : null;
  return {
    user_id: userId,
    session_id: safeText(e.session_id, 64),
    event_type: e.event_type,
    event_name: safeText(e.event_name, 200),
    payload,
    platform,
    app_version: safeText(e.app_version, 40),
  };
}
