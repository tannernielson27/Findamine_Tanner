/**
 * Event envelope (pilot 2026-11): the app session, platform and app version
 * attached to every client-logged event, so behavior can be split by device
 * and release and grouped into sessions.
 *
 * - session_id: random per app session, kept in sessionStorage; a new one
 *   starts after SESSION_IDLE_MS without activity.
 * - platform: ios / android / web (native wrapper detection).
 * - app_version: native "version (build)" plus the web build's commit, since
 *   the wrapper loads the web app remotely and the two release separately.
 *
 * Browser-only at call time; safe to import anywhere.
 */

import { nativePlatform } from "@/lib/native/platform";

export const SESSION_IDLE_MS = 30 * 60 * 1000;
const SESSION_KEY = "fm.telemetry.session";

export interface EventEnvelope {
  session_id: string;
  platform: string;
  app_version: string;
}

interface StoredSession {
  id: string;
  lastActive: number;
}

function newSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Pure session rule: keep the stored session if it was active within the idle
 * window, otherwise start a new one. Always returns the refreshed record.
 */
export function nextSession(stored: StoredSession | null, now: number, makeId: () => string): StoredSession {
  if (stored && typeof stored.id === "string" && now - stored.lastActive <= SESSION_IDLE_MS) {
    return { id: stored.id, lastActive: now };
  }
  return { id: makeId(), lastActive: now };
}

let memorySession: StoredSession | null = null;

/** Current app session id; touching it counts as activity. */
export function currentSessionId(now: number = Date.now()): string {
  let stored: StoredSession | null = memorySession;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (raw) stored = JSON.parse(raw) as StoredSession;
  } catch {
    // blocked storage: fall back to the in-memory session
  }
  const next = nextSession(stored, now, newSessionId);
  memorySession = next;
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next.id;
}

/** Web build id (Vercel system env), or "dev". */
export function webBuildId(sha: string | undefined = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA): string {
  return sha ? sha.slice(0, 7) : "dev";
}

/** Pure: combine the native app version (if any) with the web build. */
export function formatAppVersion(nativeVersion: string | null, webBuild: string): string {
  return (nativeVersion ? `${nativeVersion}+web.${webBuild}` : `web.${webBuild}`).slice(0, 40);
}

let versionPromise: Promise<string> | null = null;

/** App version string, resolved once per page load. Never rejects. */
export function appVersion(): Promise<string> {
  if (!versionPromise) {
    versionPromise = (async () => {
      let native: string | null = null;
      if (nativePlatform() !== "web") {
        try {
          const { App } = await import("@capacitor/app");
          const info = await App.getInfo();
          native = `${info.version} (${info.build})`;
        } catch {
          native = null;
        }
      }
      return formatAppVersion(native, webBuildId());
    })();
  }
  return versionPromise;
}

/** Full envelope for one event. Never rejects. */
export async function eventEnvelope(): Promise<EventEnvelope> {
  return {
    session_id: currentSessionId(),
    platform: nativePlatform(),
    app_version: await appVersion(),
  };
}
