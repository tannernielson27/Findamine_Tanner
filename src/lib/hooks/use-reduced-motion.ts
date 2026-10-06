"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

const getServerSnapshot = () => false;

/**
 * Returns true when the user has asked the OS to reduce motion.
 *
 * Used to suppress confetti and heavy entrance animations in the play loop so
 * the reward beats stay legible (and accessible) for motion-sensitive players.
 * SSR-safe: `false` on the server and during hydration, then the real
 * preference, kept in sync if the OS setting changes.
 */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
