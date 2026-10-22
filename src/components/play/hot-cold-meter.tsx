"use client";

import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import { cn } from "@/lib/utils/cn";

interface HotColdMeterProps {
  /** 1 (icy) … 5 (burning). */
  level: number;
  /** Marker position, % from the cold end. */
  markerPercent: number;
}

const STEPS = [
  "bg-proximity-1 rounded-l-md rounded-r-[2px]",
  "bg-proximity-2 rounded-[2px]",
  "bg-proximity-3 rounded-[2px]",
  "bg-proximity-4 rounded-[2px]",
  "bg-proximity-5 rounded-r-md rounded-l-[2px]",
];

/**
 * One glanceable 5-step cold → hot scale with a ringed marker on the current
 * step. Steps differ in lightness as well as hue (proximity tokens), so the
 * scale still reads for colour-blind players. The distance card around it
 * carries the words; this is decoration for sighted players (aria-hidden).
 */
export default function HotColdMeter({ level, markerPercent }: HotColdMeterProps) {
  const reducedMotion = useReducedMotion();
  // "Burning" is the climax — you're right on top of it. Give it a heartbeat.
  const isBurning = level === 5;

  return (
    <div className="relative pt-1.5" aria-hidden="true">
      <div className="grid grid-cols-5 gap-1">
        {STEPS.map((cls) => (
          <span key={cls} className={cn("h-3", cls)} />
        ))}
      </div>
      {/* The marker slides with a compositor transform: a full-width layer
          translated by the position, with the dot pinned to its left edge. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 transition-transform duration-700 ease-out motion-reduce:transition-none"
        style={{ transform: `translateX(${markerPercent}%)` }}
      >
        <span
          className={cn(
            "absolute -ml-3 block h-6 w-6 rounded-full border-4 border-ink bg-white",
            isBurning && !reducedMotion && "fm-burning-pulse"
          )}
        />
      </div>
      <div className="mt-2 flex justify-between text-[13px] font-semibold text-ink">
        <span>Cold</span>
        <span>Hot</span>
      </div>
    </div>
  );
}
