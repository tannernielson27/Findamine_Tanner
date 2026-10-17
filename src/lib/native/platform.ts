/**
 * Is this page running inside the Capacitor iOS wrapper?
 *
 * The native bridge injects `window.Capacitor` before any page script runs, so
 * checking it is synchronous and needs no import of @capacitor/core (which
 * keeps this file safe to import from server components and from SSR). Code
 * that calls a plugin imports it dynamically after this returns true.
 */

import { detectPlatform, type AppPlatform } from "@/lib/permissions/primer";

export type { AppPlatform };

/** "ios" / "android" inside the wrapper, "web" in a browser or on the server. */
export function nativePlatform(win?: unknown): AppPlatform {
  return win === undefined ? detectPlatform() : detectPlatform(win);
}

/** True only inside the native wrapper. Never throws; false during SSR. */
export function isNativeApp(win?: unknown): boolean {
  return nativePlatform(win) !== "web";
}
