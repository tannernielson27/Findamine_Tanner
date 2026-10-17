/**
 * One-time native setup when the web app starts inside the iOS wrapper.
 * Called by components/native/native-bootstrap.tsx; does nothing on the web.
 *
 * - tags <html class="fm-native"> for native-only CSS (globals.css)
 * - status bar: dark text over the light app chrome
 * - hides the launch splash once React has rendered
 * - routes universal links / "open URL" events for our hosts into the web
 *   view, and nothing else (inAppPath rejects other hosts and schemes)
 * - refreshes the push token if notifications are already on (never prompts)
 */

import { inAppPath } from "./app-hosts";
import { isNativeApp } from "./platform";
import { refreshPushRegistration } from "./push";

let started = false;

/** Navigates the web view to an in-app URL; ignores anything else. */
export function openInApp(url: string, nav: { assign: (path: string) => void } = window.location): boolean {
  const path = inAppPath(url);
  if (!path) return false;
  nav.assign(path);
  return true;
}

export async function startNativeApp(): Promise<void> {
  if (started || !isNativeApp()) return;
  started = true;
  document.documentElement.classList.add("fm-native");

  const [{ StatusBar, Style }, { SplashScreen }, { App }] = await Promise.all([
    import("@capacitor/status-bar"),
    import("@capacitor/splash-screen"),
    import("@capacitor/app"),
  ]);

  await Promise.allSettled([
    StatusBar.setStyle({ style: Style.Light }),
    SplashScreen.hide({ fadeOutDuration: 250 }),
  ]);

  // Universal links (once Associated Domains is set up) and app-switch URLs.
  void App.addListener("appUrlOpen", ({ url }) => {
    openInApp(url);
  });

  void refreshPushRegistration();
}
