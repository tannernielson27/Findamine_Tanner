"use client";

import { Loader2, MapPin, Navigation2 } from "lucide-react";
import HotColdMeter from "@/components/play/hot-cold-meter";
import { bearingDegrees, compassWord, heatDisplay, splitDistanceLabel, type LatLng } from "@/lib/play/proximity";
import { useThrottledAnnouncement } from "@/lib/play/use-play-feedback";
import type { GpsStatus, HotCold } from "@/lib/play/play-types";

interface ProximityPanelProps {
  hotCold: HotCold | null;
  gpsStatus: GpsStatus;
  userPos: LatLng | null;
  target: LatLng | null;
}

const CARD = "rounded-[24px] bg-white px-5 pt-4 pb-[18px] text-ink shadow-[0_8px_24px_rgb(28_36_48/0.16)]";

/** Direction to the stop. The map is north-up, so the arrow is too (no compass heading). */
function DirectionBadge({ bearing, color, tint }: { bearing: number | null; color: string; tint: string }) {
  return (
    <span
      className="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full"
      style={{ background: tint, color }}
    >
      {bearing == null ? (
        <MapPin className="h-[30px] w-[30px]" strokeWidth={2.4} aria-hidden="true" />
      ) : (
        <>
          <span aria-hidden="true" className="absolute top-1 text-[10px] font-bold leading-none">N</span>
          <Navigation2
            className="h-[34px] w-[34px] transition-transform duration-500 ease-out motion-reduce:transition-none"
            fill="currentColor"
            strokeWidth={1.5}
            style={{ transform: `rotate(${Math.round(bearing)}deg)` }}
            aria-hidden="true"
          />
        </>
      )}
    </span>
  );
}

/**
 * The navigate HUD card: distance in big numerals, a plain heat label, the
 * direction arrow, and the 5-step meter. Screen readers get a throttled
 * polite announcement when the heat level changes, not every GPS tick.
 */
export function ProximityPanel({ hotCold, gpsStatus, userPos, target }: ProximityPanelProps) {
  const heat = heatDisplay(hotCold?.zone);
  const bearing = userPos && target ? bearingDegrees(userPos, target) : null;
  const distance = hotCold ? splitDistanceLabel(hotCold.distanceLabel) : null;
  const direction = bearing != null ? `, to the ${compassWord(bearing)}` : "";
  const announcement = useThrottledAnnouncement(
    heat ? `heat-${heat.level}` : null,
    heat && hotCold ? `${heat.label}. ${hotCold.distanceLabel} away${direction}.` : ""
  );

  const liveRegion = (
    <p role="status" aria-live="polite" className="sr-only">
      {announcement}
    </p>
  );

  if (!hotCold || !heat || !distance) {
    // GPS is working but there is no hot/cold reading (the creator turned it
    // off for this stop, or the last ping failed), or we're still waiting.
    const waiting = gpsStatus !== "active";
    return (
      <div className={`${CARD} flex items-center gap-4`}>
        {waiting ? (
          <Loader2 className="h-8 w-8 shrink-0 animate-spin text-link motion-reduce:animate-none" aria-hidden="true" />
        ) : (
          <MapPin className="h-8 w-8 shrink-0 text-juniper-deep" aria-hidden="true" />
        )}
        <p role="status" className="text-lg font-bold leading-snug">
          {waiting ? "Finding your location…" : "GPS is on. We'll tell you when you arrive."}
        </p>
      </div>
    );
  }

  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      {liveRegion}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-[family-name:var(--font-display)] text-[64px] font-bold leading-[0.95] tracking-[-0.01em] tabular-nums">
            {distance.value}
            {distance.unit && <span className="ml-1 text-[28px] font-semibold">{distance.unit}</span>}
          </span>
          <span className="mt-1.5 text-lg font-bold" style={{ color: heat.textColor }}>
            {heat.label}
          </span>
        </div>
        <DirectionBadge bearing={bearing} color={heat.textColor} tint={heat.tint} />
      </div>
      <HotColdMeter level={heat.level} markerPercent={heat.markerPercent} />
    </div>
  );
}
