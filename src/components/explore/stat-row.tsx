"use client";

/**
 * Hunt detail key stats: stops · minutes · distance away · play mode.
 * Distance appears only when location is already granted (it never asks),
 * measured to the start area on this device.
 */
import { distanceMeters, formatDistance } from "@/lib/hunts/card-data";
import { useSilentLocation } from "./explore-location";

interface StatRowProps {
  stops: number;
  minutes: number | null;
  mode: string | null;
  start: { lat: number; lng: number } | null;
}

interface Stat {
  value: string;
  label: string;
  numeric: boolean;
}

export function StatRow({ stops, minutes, mode, start }: StatRowProps) {
  const origin = useSilentLocation();
  const dist = origin && start ? formatDistance(distanceMeters(origin, start)) : null;

  const stats: Stat[] = [];
  if (stops > 0) stats.push({ value: String(stops), label: stops === 1 ? "stop" : "stops", numeric: true });
  if (minutes) stats.push({ value: String(minutes), label: "minutes", numeric: true });
  if (dist) {
    const [value, unit] = dist.split(" ");
    stats.push({ value, label: `${unit} away`, numeric: true });
  }
  if (mode) stats.push({ value: mode, label: "play mode", numeric: false });
  if (stats.length === 0) return null;

  return (
    <dl
      className="grid rounded-[18px] border border-themed-border bg-surface px-1 py-3.5"
      style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={`flex flex-col-reverse items-center gap-0.5 ${i < stats.length - 1 ? "border-r border-divider" : ""}`}
        >
          <dt className="text-[13px] text-themed-muted">{s.label}</dt>
          <dd className={`font-[family-name:var(--font-display)] text-[22px] font-semibold text-themed-text ${s.numeric ? "tabular-nums" : ""}`}>
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
