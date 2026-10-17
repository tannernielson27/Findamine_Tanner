import type { CapacitorConfig } from "@capacitor/cli";
// Relative import: the Capacitor CLI loads this file without the "@/" alias.
import { APP_HOSTS } from "./src/lib/native/app-hosts";

/**
 * Capacitor iOS wrapper for Findamine (see docs/ios-build-on-mac.md).
 *
 * The app loads the live Next.js site instead of a static export: the site
 * relies on server components, API routes and cookie sessions, which only run
 * on Vercel. Native features (location, camera, push, status bar, splash,
 * offline screen) come from the Capacitor plugins wired up in src/lib/native/.
 *
 * APP_URL is the ONE place the site address lives. It moves to
 * https://findamine.app once that domain points at the Vercel project. Because
 * every host below is in allowNavigation, a Vercel redirect from the old host
 * to findamine.app keeps working inside the app without a new build; change
 * APP_URL in the next build so launch skips the redirect.
 */
const APP_URL = "https://findamine-tanner.vercel.app";

const BRAND_PAPER = "#FEFCF6";

const config: CapacitorConfig = {
  appId: "app.findamine",
  appName: "Findamine",
  // Bundled shell: the offline / load-error screen (server.errorPath) and the
  // fallback index. The real app comes from APP_URL.
  webDir: "ios-shell",
  backgroundColor: BRAND_PAPER,
  server: {
    url: APP_URL,
    // Hosts the in-app web view may navigate to; anything else opens in Safari.
    allowNavigation: [...APP_HOSTS],
    errorPath: "offline.html",
  },
  ios: {
    // The web app pads itself with env(safe-area-inset-*) (viewport-fit=cover),
    // so the web view must not add its own insets on top.
    contentInset: "never",
    backgroundColor: BRAND_PAPER,
    // Lets the site detect the wrapper server-side if ever needed; the client
    // uses Capacitor.isNativePlatform() (src/lib/native/platform.ts).
    appendUserAgent: "FindamineApp/1",
    // No pinch-zoom lock, no link previews of in-app pages.
    allowsLinkPreview: false,
    scrollEnabled: true,
  },
  plugins: {
    SplashScreen: {
      // Hidden by the web app once it has rendered (src/lib/native/bootstrap.ts),
      // with this as a safety net if the page never loads.
      launchAutoHide: true,
      launchShowDuration: 3000,
      launchFadeOutDuration: 250,
      backgroundColor: BRAND_PAPER,
      showSpinner: false,
    },
    StatusBar: {
      // Dark text on the light paper/white app chrome.
      style: "LIGHT",
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export { APP_URL };
export default config;
