/**
 * Location for the play loop and the hunt builder, on web and in the iOS app.
 *
 * In a browser this is navigator.geolocation, unchanged. Inside the wrapper
 * it is @capacitor/geolocation (Core Location), which uses the app's own
 * "When In Use" permission and purpose string instead of WebKit's per-site
 * prompt. The plugin is imported only when native, so web bundles and SSR
 * never evaluate it.
 *
 * Callers still show the location primer (components/permissions) before the
 * first call: either path can raise the system prompt.
 */

import { isNativeApp } from "./platform";

export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Metres, when the platform reports it. */
  accuracy: number | null;
}

export type LocationErrorKind = "denied" | "unavailable" | "timeout";

export interface LocationOptions {
  enableHighAccuracy?: boolean;
  maximumAge?: number;
  timeout?: number;
}

export class LocationError extends Error {
  constructor(public readonly kind: LocationErrorKind, message?: string) {
    super(message ?? `Location ${kind}`);
    this.name = "LocationError";
  }
}

/** Plugin error codes (README of @capacitor/geolocation) that mean "permission is off". */
const NATIVE_DENIED_CODES = new Set(["OS-PLUG-GLOC-0003", "OS-PLUG-GLOC-0008", "OS-PLUG-GLOC-0009"]);
const NATIVE_TIMEOUT_CODES = new Set(["OS-PLUG-GLOC-0010"]);

/**
 * Collapses a web GeolocationPositionError (numeric code 1/2/3) or a Capacitor
 * plugin error ("OS-PLUG-GLOC-00xx" code or message) to the three states the
 * UI distinguishes. Anything unrecognised is "unavailable".
 */
export function classifyLocationError(err: unknown): LocationErrorKind {
  if (err instanceof LocationError) return err.kind;
  const e = (err ?? {}) as { code?: unknown; message?: unknown };
  if (typeof e.code === "number") {
    if (e.code === 1) return "denied";
    if (e.code === 3) return "timeout";
    return "unavailable";
  }
  if (typeof e.code === "string") {
    if (NATIVE_DENIED_CODES.has(e.code)) return "denied";
    if (NATIVE_TIMEOUT_CODES.has(e.code)) return "timeout";
  }
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (/denied|not authori[sz]ed|restricted|permission/.test(message)) return "denied";
  if (/time(d)? ?out/.test(message)) return "timeout";
  return "unavailable";
}

function toFix(coords: { latitude: number; longitude: number; accuracy?: number | null }): LocationFix {
  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy: typeof coords.accuracy === "number" ? coords.accuracy : null,
  };
}

/** False only in a browser without the Geolocation API. */
export function locationSupported(): boolean {
  if (isNativeApp()) return true;
  return typeof navigator !== "undefined" && !!navigator.geolocation;
}

/**
 * Starts continuous updates. Returns a stop function that is safe to call at
 * any time, including before the native watch has finished starting.
 */
export function watchLocation(
  onFix: (fix: LocationFix) => void,
  onError: (kind: LocationErrorKind) => void,
  options: LocationOptions = {}
): () => void {
  if (!isNativeApp()) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      onError("unavailable");
      return () => {};
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => onFix(toFix(pos.coords)),
      (err) => onError(classifyLocationError(err)),
      options
    );
    return () => navigator.geolocation.clearWatch(id);
  }

  let stopped = false;
  let watchId: string | null = null;
  let clear: ((id: string) => void) | null = null;

  void import("@capacitor/geolocation")
    .then(async ({ Geolocation }) => {
      if (stopped) return;
      clear = (id) => void Geolocation.clearWatch({ id }).catch(() => {});
      const id = await Geolocation.watchPosition(options, (position, err) => {
        if (stopped) return;
        if (err || !position) {
          onError(classifyLocationError(err));
          return;
        }
        onFix(toFix(position.coords));
      });
      if (stopped) clear(id);
      else watchId = id;
    })
    .catch((err: unknown) => {
      if (!stopped) onError(classifyLocationError(err));
    });

  return () => {
    stopped = true;
    if (watchId && clear) clear(watchId);
    watchId = null;
  };
}

/** One position fix. Rejects with a LocationError. */
export async function getCurrentLocation(options: LocationOptions = {}): Promise<LocationFix> {
  if (!isNativeApp()) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      throw new LocationError("unavailable", "GPS not available on this device");
    }
    return new Promise<LocationFix>((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(toFix(pos.coords)),
        (err) => reject(new LocationError(classifyLocationError(err), err.message)),
        options
      );
    });
  }
  try {
    const { Geolocation } = await import("@capacitor/geolocation");
    const position = await Geolocation.getCurrentPosition(options);
    return toFix(position.coords);
  } catch (err) {
    throw new LocationError(classifyLocationError(err), err instanceof Error ? err.message : undefined);
  }
}
