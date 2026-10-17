/**
 * Permission state for the primer, from the right source on each platform.
 *
 * In a browser this is the Permissions API (queryPermission). Inside the iOS
 * app the system permission belongs to the app, not the web page, so it is
 * read from the plugin that will make the request: Core Location, the camera,
 * or push notifications. The microphone has no plugin (WKWebView's
 * getUserMedia raises the app's own prompt), so it keeps the web query.
 */

import { queryPermission, type PermissionKind, type PermissionStatus } from "@/lib/permissions/primer";
import { isNativeApp } from "./platform";

/** Maps a Capacitor PermissionState ("prompt-with-rationale", "limited", ...) to ours. */
export function fromNativeState(state: unknown): PermissionStatus {
  switch (state) {
    case "granted":
    case "limited":
      return "granted";
    case "denied":
      return "denied";
    case "prompt":
    case "prompt-with-rationale":
      return "prompt";
    default:
      return "unknown";
  }
}

async function nativeState(kind: PermissionKind): Promise<unknown> {
  switch (kind) {
    case "location": {
      const { Geolocation } = await import("@capacitor/geolocation");
      return (await Geolocation.checkPermissions()).location;
    }
    case "camera": {
      const { Camera } = await import("@capacitor/camera");
      return (await Camera.checkPermissions()).camera;
    }
    case "notifications": {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      return (await PushNotifications.checkPermissions()).receive;
    }
    default:
      return undefined;
  }
}

/** Current permission state for the primer. Never throws; "unknown" on failure. */
export async function queryPlatformPermission(kind: PermissionKind): Promise<PermissionStatus> {
  if (!isNativeApp() || kind === "microphone") return queryPermission(kind);
  try {
    return fromNativeState(await nativeState(kind));
  } catch {
    // e.g. Location Services switched off device-wide: let the primer explain.
    return "unknown";
  }
}
