/**
 * Push notifications in the iOS app (@capacitor/push-notifications).
 *
 * Nothing here runs on first launch. The player turns notifications on from
 * Settings (components/native/push-settings.tsx), which shows the
 * notifications primer and only then calls enablePush(), raising the iOS
 * prompt. The APNs token is stored server-side by
 * POST /api/v1/notifications/devices and removed on disable and on sign-out.
 *
 * Every function is a no-op (or "unavailable") outside the wrapper, and the
 * plugin is imported lazily so web bundles and SSR never evaluate it.
 */

import { isNativeApp } from "./platform";

const TOKEN_KEY = "findamine:push-token";
const DEVICES_URL = "/api/v1/notifications/devices";
const REGISTER_TIMEOUT_MS = 15_000;

export type PushEnableResult = "enabled" | "denied" | "unavailable" | "failed";
export type PushState = "on" | "off" | "denied" | "unavailable";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Blocked storage: the server row still exists; sign-out can't clear it.
  }
}

async function appVersion(): Promise<string | null> {
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return `${info.version} (${info.build})`.slice(0, 40);
  } catch {
    return null;
  }
}

/** Calls register() and resolves with the APNs token, or rejects. */
async function obtainToken(): Promise<string> {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = [];
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const h of handles) void h.then((x) => x.remove()).catch(() => {});
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error("Push registration timed out"))), REGISTER_TIMEOUT_MS);
    handles.push(PushNotifications.addListener("registration", (t) => finish(() => resolve(t.value))));
    handles.push(
      PushNotifications.addListener("registrationError", (e) => finish(() => reject(new Error(e.error))))
    );
    PushNotifications.register().catch((err: unknown) =>
      finish(() => reject(err instanceof Error ? err : new Error("Push registration failed")))
    );
  });
}

async function sendToken(token: string): Promise<boolean> {
  const res = await fetch(DEVICES_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, platform: "ios", app_version: await appVersion() }),
  });
  return res.ok;
}

/** Current state for the Settings toggle. Never throws. */
export async function pushState(): Promise<PushState> {
  if (!isNativeApp()) return "unavailable";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === "denied") return "denied";
    return receive === "granted" && readStoredToken() ? "on" : "off";
  } catch {
    return "unavailable";
  }
}

/**
 * Asks iOS for permission (if it hasn't been asked), registers with APNs and
 * saves the token for the signed-in user. Call only after the primer.
 */
export async function enablePush(): Promise<PushEnableResult> {
  if (!isNativeApp()) return "unavailable";
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let { receive } = await PushNotifications.checkPermissions();
    if (receive === "prompt" || receive === "prompt-with-rationale") {
      receive = (await PushNotifications.requestPermissions()).receive;
    }
    if (receive !== "granted") return "denied";
    const token = await obtainToken();
    if (!(await sendToken(token))) return "failed";
    writeStoredToken(token);
    return "enabled";
  } catch {
    return "failed";
  }
}

/** Removes this device's token from the server and stops APNs delivery. */
export async function disablePush(): Promise<void> {
  if (!isNativeApp()) return;
  await forgetPushDevice();
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    await PushNotifications.unregister();
  } catch {
    // Already unregistered; the server row is gone either way.
  }
}

/**
 * Deletes this device's server row while the session is still valid. Called
 * on sign-out so the next person on a shared phone doesn't get the previous
 * player's notifications. Never throws.
 */
export async function forgetPushDevice(): Promise<void> {
  if (!isNativeApp()) return;
  const token = readStoredToken();
  if (!token) return;
  try {
    await fetch(DEVICES_URL, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform: "ios" }),
    });
  } catch {
    // Offline: the row stays until the next sign-in re-registers or a later delete.
  } finally {
    writeStoredToken(null);
  }
}

/**
 * On launch: if the player already turned notifications on, re-register so a
 * rotated APNs token reaches the server. Never prompts. Never throws.
 */
export async function refreshPushRegistration(): Promise<void> {
  if (!isNativeApp() || !readStoredToken()) return;
  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    if ((await PushNotifications.checkPermissions()).receive !== "granted") return;
    const token = await obtainToken();
    if (token !== readStoredToken() && (await sendToken(token))) writeStoredToken(token);
  } catch {
    // Try again next launch.
  }
}
