"use client";

import { useEffect, useState } from "react";

/**
 * The device's clock, re-read every `intervalMs`, for text that counts down.
 * Pass null to read it once and not tick (nothing on screen depends on it).
 */
export function useTicker(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs === null) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
