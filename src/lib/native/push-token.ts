/**
 * Validation for push-device registrations (POST/DELETE
 * /api/v1/notifications/devices). Pure, shared by the route and its tests.
 *
 * iOS: the APNs device token as Capacitor reports it, a hex string (32 bytes
 * today = 64 hex characters; Apple says not to rely on the length, so up to
 * 200 is accepted). Android is accepted for a future build (an FCM
 * registration token).
 */

export type PushPlatform = "ios" | "android";

export interface DeviceRegistration {
  token: string;
  platform: PushPlatform;
  /** The wrapper's version string, for debugging delivery problems. */
  app_version: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const APNS_TOKEN_RE = /^[0-9a-f]{64,200}$/;
const FCM_TOKEN_RE = /^[A-Za-z0-9_:.-]{32,4096}$/;
const APP_VERSION_RE = /^[0-9A-Za-z.+_ ()-]{1,40}$/;

/** Canonical form of a token for storage and lookup, or null if it's not valid. */
export function normalizePushToken(platform: PushPlatform, token: unknown): string | null {
  if (typeof token !== "string") return null;
  const trimmed = token.trim();
  if (platform === "ios") {
    const hex = trimmed.toLowerCase();
    return APNS_TOKEN_RE.test(hex) ? hex : null;
  }
  return FCM_TOKEN_RE.test(trimmed) ? trimmed : null;
}

function isPlatform(value: unknown): value is PushPlatform {
  return value === "ios" || value === "android";
}

/** Body of POST /api/v1/notifications/devices: { token, platform, app_version? }. */
export function parseDeviceRegistration(body: unknown): ParseResult<DeviceRegistration> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Send a JSON body with token and platform." };
  }
  const b = body as Record<string, unknown>;
  if (!isPlatform(b.platform)) return { ok: false, error: "platform must be \"ios\" or \"android\"." };
  const token = normalizePushToken(b.platform, b.token);
  if (!token) return { ok: false, error: "token isn't a valid push token for that platform." };

  let appVersion: string | null = null;
  if (b.app_version !== undefined && b.app_version !== null) {
    if (typeof b.app_version !== "string" || !APP_VERSION_RE.test(b.app_version)) {
      return { ok: false, error: "app_version must be a short version string." };
    }
    appVersion = b.app_version;
  }
  return { ok: true, value: { token, platform: b.platform, app_version: appVersion } };
}

/** Body of DELETE /api/v1/notifications/devices: { token, platform? } (platform defaults to ios). */
export function parseDeviceRemoval(body: unknown): ParseResult<{ token: string }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Send a JSON body with token." };
  }
  const b = body as Record<string, unknown>;
  const platform = b.platform === undefined ? "ios" : b.platform;
  if (!isPlatform(platform)) return { ok: false, error: "platform must be \"ios\" or \"android\"." };
  const token = normalizePushToken(platform, b.token);
  if (!token) return { ok: false, error: "token isn't a valid push token for that platform." };
  return { ok: true, value: { token } };
}
