"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { EASE_OUT } from "@/lib/motion";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface CountUpProps {
  value: number;
  /** Seconds. Short on purpose: the number is information, not a show. */
  duration?: number;
  className?: string;
}

/**
 * Counts from the previously shown value (0 on mount) to `value`. The digits
 * update through a motion value, so React doesn't re-render per frame. Pair
 * with `tabular-nums` so the width doesn't jitter. Screen readers get the
 * final value from a visually hidden copy, never the in-between frames.
 */
// Fixed locale so the server render and hydration format identically.
const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

export function CountUp({ value, duration = 0.6, className }: CountUpProps) {
  const reducedMotion = useReducedMotion();
  const current = useMotionValue(0);
  const display = useTransform(current, (v) => NUMBER_FORMAT.format(Math.round(v)));

  useEffect(() => {
    if (reducedMotion) {
      current.set(value);
      return;
    }
    const controls = animate(current, value, { duration, ease: EASE_OUT });
    return () => controls.stop();
  }, [current, value, duration, reducedMotion]);

  return (
    <span className={className}>
      <motion.span aria-hidden="true">{display}</motion.span>
      <span className="sr-only">{NUMBER_FORMAT.format(value)}</span>
    </span>
  );
}
