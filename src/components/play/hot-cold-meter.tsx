"use client";

interface HotColdMeterProps {
  zone: string;
  color: string;
  label: string;
  emoji: string;
  distance: string;
}

const ZONE_POSITIONS: Record<string, number> = {
  icy: 10,
  cold: 30,
  warm: 50,
  hot: 70,
  burning: 90,
};

/**
 * Darker text tones on the same cold→hot scale as the zone `color`, so the
 * label reads at ≥4.5:1 on the white meter card in direct sunlight. The raw
 * zone color still drives the indicator border.
 */
const ZONE_TEXT: Record<string, string> = {
  icy: "#1E40AF",
  cold: "#1D4ED8",
  warm: "#15803D",
  hot: "#C2410C",
  burning: "#B91C1C",
};

export default function HotColdMeter({ zone, color, label, emoji, distance }: HotColdMeterProps) {
  const position = ZONE_POSITIONS[zone] || 50;
  // "Burning" is the climax — you're right on top of it. Give it a heartbeat.
  const isBurning = zone === "burning";
  const textColor = ZONE_TEXT[zone] ?? "var(--color-text, #1C2430)";

  return (
    <div
      className={`flex flex-col items-center gap-2 rounded-xl border border-themed-border bg-surface/95 backdrop-blur p-4 transition-shadow duration-500 ${
        isBurning ? "shadow-[0_0_28px_-4px_rgba(239,68,68,0.7)] ring-2 ring-red-400/60" : "shadow-[var(--shadow-card)]"
      }`}
      role="meter"
      aria-valuenow={position}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Hot cold meter: ${label}, ${distance}`}
    >
      <div className={`text-3xl ${isBurning ? "fm-burning-pulse" : ""}`} aria-hidden="true">{emoji}</div>

      {/* Meter bar */}
      <div className="relative w-8 h-48 rounded-full overflow-hidden bg-gradient-to-t from-blue-500 via-green-400 via-orange-400 to-red-500" aria-hidden="true">
        {/* Indicator: a full-height layer slid up by `position`% of the track,
            so the move is a compositor transform rather than a layout change. */}
        <div
          className="absolute inset-0 transition-transform duration-700 ease-out"
          style={{ transform: `translateY(-${position}%)` }}
        >
          <div
            className="absolute bottom-0 left-0 right-0 h-3 rounded-full bg-white shadow-md border-2"
            style={{ borderColor: color }}
          />
        </div>
      </div>

      <div className="text-center">
        <p
          className={`font-[family-name:var(--font-display)] text-base font-semibold ${isBurning ? "fm-burning-pulse" : ""}`}
          style={{ color: textColor }}
        >
          {label}
        </p>
        <p className="text-sm font-semibold tabular-nums text-themed-muted">{distance}</p>
      </div>
    </div>
  );
}
