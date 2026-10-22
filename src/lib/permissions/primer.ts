/* ─── Permission primers ────────────────────────────────────────
   Apple guideline 5.1.1 and the HIG ask apps to explain why they need a
   permission *before* the system prompt appears, and to handle a "no"
   gracefully. This module holds the pure logic and copy for that flow so
   the UI (components/permissions/permission-primer.tsx) stays thin and the
   decisions are unit-testable without a DOM.

   Keep the primer copy in step with the iOS purpose strings in
   docs/ios-permission-strings.md: the reviewer reads both. */

export type PermissionKind = "location" | "microphone" | "camera" | "notifications";

/** What the platform reports, collapsed to the states we act on. */
export type PermissionStatus = "granted" | "denied" | "prompt" | "unknown";

/** What the primer should do when it mounts. */
export type PrimerDecision = "skip" | "show" | "denied";

/** Where the app is running, for picking "how to turn it back on" wording. */
export type AppPlatform = "ios" | "android" | "web";

export interface PrimerCopy {
  title: string;
  reason: string;
  /** The primer's only action: it always leads to the OS prompt (5.1.1(iv)). */
  continueLabel: string;
}

export const PRIMER_COPY: Record<PermissionKind, PrimerCopy> = {
  location: {
    title: "Use your location for this hunt?",
    reason:
      "Findamine uses your location only while you're playing a hunt, to show you on the map and tell you when you've reached a stop. We save where you checked in at each stop, and never track you in the background.",
    continueLabel: "Continue",
  },
  microphone: {
    title: "Use your microphone?",
    reason:
      "Findamine uses your microphone only to record your spoken answer to this challenge. It starts recording when you continue and stops when you tap Stop Recording. Your recording is saved privately with your answer; on a child's account it stays on this device.",
    continueLabel: "Continue",
  },
  // Native app only: the web build uses the browser's file picker.
  camera: {
    title: "Use your camera?",
    reason:
      "Findamine uses your camera only when you tap Take Photo, so you can take a geo-selfie at a stop or photograph something for a challenge. Geo-selfies are stored privately with your hunt.",
    continueLabel: "Continue",
  },
  // Native app only, and only after the player asks for notifications in Settings.
  notifications: {
    title: "Turn on notifications?",
    reason:
      "Findamine uses your notifications only to tell you about your own hunts, classes and teams, like a new hunt from your teacher. You can turn them off here or in your iPhone's Settings at any time.",
    continueLabel: "Continue",
  },
};

/** What each permission unlocks, used in the "it's off" message. */
const FEATURE_FOR: Record<PermissionKind, string> = {
  location: "navigation steps",
  microphone: "spoken answers",
  camera: "photos",
  notifications: "notifications",
};

const SETTING_NAME: Record<PermissionKind, string> = {
  location: "Location",
  microphone: "Microphone",
  camera: "Camera",
  notifications: "Notifications",
};

/** Heading for the "permission is off" state. Platform-neutral. */
export function deniedTitle(kind: PermissionKind): string {
  return `${SETTING_NAME[kind]} is off for Findamine`;
}

/**
 * Tells the player how to turn a permission back on, in the words their
 * platform uses. Native iOS/Android point at the system Settings app; the
 * web build points at the browser's site settings.
 */
export function deniedMessage(kind: PermissionKind, platform: AppPlatform): string {
  const feature = FEATURE_FOR[kind];
  const setting = SETTING_NAME[kind];
  switch (platform) {
    case "ios":
      return `Turn it on in Settings > Findamine > ${setting} to use ${feature}.`;
    case "android":
      return `Turn it on in Settings > Apps > Findamine > Permissions to use ${feature}.`;
    default:
      return `Turn it on in your browser's site settings for Findamine, then reload the page to use ${feature}.`;
  }
}

/* ─── Platform detection ──────────────────────────────────────── */

interface CapacitorLike {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/**
 * Detects the Capacitor shell at runtime without importing @capacitor/core:
 * the native bridge injects `window.Capacitor` before the page loads.
 */
export function detectPlatform(win: unknown = typeof window === "undefined" ? undefined : window): AppPlatform {
  try {
    const cap = (win as { Capacitor?: CapacitorLike } | undefined)?.Capacitor;
    if (!cap || typeof cap.isNativePlatform !== "function" || !cap.isNativePlatform()) return "web";
    const name = typeof cap.getPlatform === "function" ? cap.getPlatform() : "";
    if (name === "android") return "android";
    // A native shell that doesn't name itself is the iOS build we ship.
    return "ios";
  } catch {
    return "web";
  }
}

/* ─── Permission state ────────────────────────────────────────── */

interface PermissionsLike {
  query?: (descriptor: { name: string }) => Promise<{ state: string }>;
}

/** Name the Permissions API uses for each kind. */
const QUERY_NAME: Record<PermissionKind, string> = {
  location: "geolocation",
  microphone: "microphone",
  camera: "camera",
  notifications: "notifications",
};

/**
 * Asks the Permissions API for the current state. Returns "unknown" when the
 * API is missing or rejects the name (older Safari / WKWebView reject
 * "microphone"), so callers fall back to the remembered primer instead.
 */
export async function queryPermission(
  kind: PermissionKind,
  nav: unknown = typeof navigator === "undefined" ? undefined : navigator
): Promise<PermissionStatus> {
  const permissions = (nav as { permissions?: PermissionsLike } | undefined)?.permissions;
  if (!permissions || typeof permissions.query !== "function") return "unknown";
  try {
    const result = await permissions.query({ name: QUERY_NAME[kind] });
    const state = result?.state;
    return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Decides what the primer does on mount.
 * - granted: nothing to explain, start straight away.
 * - denied: the system prompt won't appear again, so show how to turn it on.
 * - prompt: the OS is about to ask, so explain first.
 * - unknown (no Permissions API): explain the first time; once the player has
 *   continued past the primer, trust the real request to report a denial.
 */
export function decidePrimer(status: PermissionStatus, primerSeen: boolean): PrimerDecision {
  if (status === "granted") return "skip";
  if (status === "denied") return "denied";
  if (status === "prompt") return "show";
  return primerSeen ? "skip" : "show";
}

/* ─── "Seen the primer" memory ────────────────────────────────── */

const STORAGE_PREFIX = "findamine:permission-primer:";

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** True once the player has pressed Continue on this primer. Never throws. */
export function hasSeenPrimer(kind: PermissionKind, storage: StorageLike | undefined = defaultStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_PREFIX + kind) === "continued";
  } catch {
    return false;
  }
}

/** Remembers that the player continued past the primer. Never throws. */
export function markPrimerSeen(kind: PermissionKind, storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.setItem(STORAGE_PREFIX + kind, "continued");
  } catch {
    // Private mode or blocked storage: the primer just shows again next time.
  }
}
