"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { nativePlatform } from "@/lib/native/platform";
import {
  flushClientEvents,
  huntIdFromPath,
  logClientError,
  logClientEvent,
  screenPath,
} from "@/lib/telemetry/client-events";

/**
 * Mounted once in the (app) layout for signed-in users. Logs:
 *  - screen_view on every route change (path only, no query string)
 *  - app_state foreground/background (page visibility, plus Capacitor
 *    appStateChange inside the native wrapper)
 *  - client_error for uncaught errors and unhandled promise rejections
 * Renders nothing.
 */
export default function TelemetryProvider() {
  const pathname = usePathname();

  useEffect(() => {
    const huntId = huntIdFromPath(pathname);
    logClientEvent("screen_view", screenPath(pathname), {
      path: screenPath(pathname),
      ...(huntId ? { hunt_id: huntId } : {}),
    });
  }, [pathname]);

  useEffect(() => {
    const onVisibility = () => {
      const state = document.hidden ? "background" : "foreground";
      logClientEvent("app_state", state, { source: "visibility", path: screenPath(window.location.pathname) });
      if (document.hidden) void flushClientEvents(true);
    };
    const onError = (e: ErrorEvent) => logClientError("window_error", e.error ?? e.message, window.location.pathname);
    const onRejection = (e: PromiseRejectionEvent) =>
      logClientError("unhandled_rejection", e.reason, window.location.pathname);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);

    // The native wrapper reports app pause/resume even when the webview's
    // visibility doesn't change (e.g. the app switcher).
    let removeNative: (() => void) | null = null;
    let cancelled = false;
    if (nativePlatform() !== "web") {
      void import("@capacitor/app")
        .then(({ App }) =>
          App.addListener("appStateChange", ({ isActive }) => {
            logClientEvent("app_state", isActive ? "foreground" : "background", {
              source: "native",
              path: screenPath(window.location.pathname),
            });
            if (!isActive) void flushClientEvents(true);
          })
        )
        .then((handle) => {
          if (cancelled) void handle.remove();
          else removeNative = () => void handle.remove();
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      removeNative?.();
    };
  }, []);

  return null;
}
