"use client";

import { useEffect } from "react";

/**
 * Mounted once in the root layout. Inside the iOS app it runs the native
 * setup (status bar, splash, universal links, push refresh); on the web it
 * returns before loading any Capacitor code. Renders nothing.
 */
export function NativeBootstrap() {
  useEffect(() => {
    // window.Capacitor is injected by the wrapper before page scripts run.
    if (!(window as { Capacitor?: unknown }).Capacitor) return;
    void import("@/lib/native/bootstrap")
      .then(({ startNativeApp }) => startNativeApp())
      .catch(() => {
        // The splash hides itself (launchAutoHide); the page still works.
      });
  }, []);
  return null;
}
