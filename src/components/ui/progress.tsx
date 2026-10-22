/**
 * Progress displays: segmented stop bar, weekly goal ring, and stats row.
 */
import { cn } from "@/lib/utils/cn";

interface SegmentsProps {
  total: number;
  /** Stops finished (filled with the done colour). */
  done: number;
  /** 1-based stop in progress, highlighted in trail orange. */
  current?: number;
  /** "light" on paper/white, "dark" on ink or juniper grounds. */
  surface?: "light" | "dark";
  height?: number;
  className?: string;
}

export function ProgressSegments({ total, done, current, surface = "light", height = 6, className }: SegmentsProps) {
  const doneColor = surface === "dark" ? "bg-juniper-bright" : "bg-juniper";
  const emptyColor = surface === "dark" ? "bg-white/20" : "bg-themed-border";
  return (
    <div
      role="img"
      aria-label={`${done} of ${total} stops complete`}
      className={cn("grid gap-1", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(total, 1)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: total }, (_, i) => {
        const n = i + 1;
        const color = n <= done ? doneColor : n === current ? "bg-brand" : emptyColor;
        return <span key={n} className={cn("rounded-full", color)} style={{ height }} />;
      })}
    </div>
  );
}

interface RingProps {
  value: number;
  goal: number;
  size?: number;
  label?: string;
}

export function ProgressRing({ value, goal, size = 76, label }: RingProps) {
  const stroke = 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  const text = label ?? `${value}/${goal}`;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${value} of ${goal}`} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-juniper-tint)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-juniper)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${pct * c} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize={size * 0.26}
        fontWeight={600}
        fill="currentColor"
      >
        {text}
      </text>
    </svg>
  );
}

export interface StatItem {
  value: string;
  label: string;
}

/** Equal-width stats with dividers, e.g. 7 stops | 50 minutes | 0.1 mi away | Solo. */
export function StatRow({ items, className }: { items: StatItem[]; className?: string }) {
  return (
    <dl
      className={cn("grid rounded-[18px] border border-themed-border bg-surface px-1 py-3.5", className)}
      style={{ gridTemplateColumns: `repeat(${Math.max(items.length, 1)}, minmax(0, 1fr))` }}
    >
      {items.map((item, i) => (
        <div key={item.label} className={cn("flex flex-col-reverse items-center gap-0.5 text-center", i < items.length - 1 && "border-r border-divider")}>
          <dt className="text-[13px] text-themed-muted">{item.label}</dt>
          <dd className="m-0 font-[family-name:var(--font-display)] text-[22px] font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
