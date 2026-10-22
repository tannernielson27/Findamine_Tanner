"use client";

import { useEffect } from "react";

/** The slice of the Screen Wake Lock API this module uses. */
export interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
}
export interface WakeLockLike {
  request: (type: "screen") => Promise<WakeLockSentinelLike>;
}
/** The slice of `document` the controller needs. */
export interface VisibilityDocument {
  visibilityState: string;
  addEventListener: (type: "visibilitychange", fn: () => void) => void;
  removeEventListener: (type: "visibilitychange", fn: () => void) => void;
}

function wakeLockApi(): WakeLockLike | null {
  if (typeof navigator === "undefined") return null;
  const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
  return api && typeof api.request === "function" ? api : null;
}

/**
 * Holds a screen wake lock until the returned stop function is called. The
 * browser drops the lock whenever the page is hidden, so it is re-requested
 * each time the page becomes visible again. Refusals are ignored.
 */
export function holdWakeLock(api: WakeLockLike, doc: VisibilityDocument): () => void {
  let sentinel: WakeLockSentinelLike | null = null;
  let stopped = false;
  let requesting = false;

  const acquire = async () => {
    if (stopped || requesting || doc.visibilityState !== "visible") return;
    if (sentinel && !sentinel.released) return;
    requesting = true;
    try {
      const lock = await api.request("screen");
      if (stopped) void lock.release().catch(() => {});
      else sentinel = lock;
    } catch {
      // Refused (battery saver, not allowed): the screen just sleeps as usual.
    } finally {
      requesting = false;
    }
  };

  const onVisibility = () => {
    if (doc.visibilityState === "visible") void acquire();
  };

  void acquire();
  doc.addEventListener("visibilitychange", onVisibility);
  return () => {
    stopped = true;
    doc.removeEventListener("visibilitychange", onVisibility);
    if (sentinel && !sentinel.released) void sentinel.release().catch(() => {});
    sentinel = null;
  };
}

/**
 * Keeps the screen awake while `active` (a hunt is being played), so the
 * phone doesn't lock mid-walk. Released when `active` turns false (finish)
 * or on unmount (pause / leaving the page). A no-op where the Screen Wake
 * Lock API is missing.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    const api = wakeLockApi();
    if (!active || !api || typeof document === "undefined") return;
    return holdWakeLock(api, document);
  }, [active]);
}
