"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hapticForHeatChange, hapticImpact, heatLevel } from "@/lib/native/haptics";
import { announcementDelay } from "@/lib/play/proximity";

/** Taps when the heat level rises (light; medium once "hot"). Silent on every other GPS fix. */
export function useHeatHaptics(zone: string | null | undefined): void {
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    const next = heatLevel(zone);
    const haptic = hapticForHeatChange(prevRef.current, next);
    prevRef.current = next;
    if (haptic) void hapticImpact(haptic);
  }, [zone]);
}

/**
 * Text for a polite live region that changes only when `key` changes (e.g.
 * the heat level, not every distance tick), and at most once per `minGapMs`.
 * The latest `text` at the moment of announcing is used.
 */
export function useThrottledAnnouncement(key: string | null, text: string, minGapMs = 8000): string {
  const [announced, setAnnounced] = useState("");
  const lastAtRef = useRef<number | null>(null);
  const textRef = useRef(text);

  useEffect(() => {
    textRef.current = text;
  }, [text]);

  useEffect(() => {
    if (!key) return;
    const delay = announcementDelay(lastAtRef.current, Date.now(), minGapMs);
    const timer = window.setTimeout(() => {
      lastAtRef.current = Date.now();
      setAnnounced(textRef.current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [key, minGapMs]);

  return announced;
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** False while the browser reports no network. True on the server. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true
  );
}
