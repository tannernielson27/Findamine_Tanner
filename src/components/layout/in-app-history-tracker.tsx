"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { noteNavigation, noteTraversal } from "@/lib/navigation/in-app-history";

/**
 * Mounted once in the root layout. Records the pages visited in this document
 * so the Back control (components/ui/back-button) can tell "an earlier page of
 * the app is behind this one" from "this is where the visit started".
 * Renders nothing.
 */
export function InAppHistoryTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Back/forward: the URL has already changed when popstate fires.
    const onPopState = () => noteTraversal(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // Runs after every navigation commits (and once on load). A back/forward
    // move was already recorded by popstate, so this is then a no-op.
    noteNavigation(window.location.pathname);
  }, [pathname]);

  return null;
}
