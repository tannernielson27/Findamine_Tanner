/**
 * FilterChip: a toggle (aria-pressed) for filter rows; 44px tall.
 * Tag: a small non-interactive label (category, "New", points).
 */
import { Check } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface FilterChipProps extends Omit<ComponentProps<"button">, "onChange"> {
  selected: boolean;
  onToggle?: () => void;
  /** Float over a map: borderless with a shadow instead of a border. */
  floating?: boolean;
}

export function FilterChip({ selected, onToggle, floating = false, className, children, ...props }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={cn(
        "inline-flex h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-[15px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
        selected
          ? "border border-ink bg-ink font-semibold text-white"
          : "border border-themed-border bg-surface font-medium text-themed-text hover:bg-themed-bg",
        floating && "border-0 shadow-raised",
        className
      )}
      {...props}
    >
      {selected && <Check className="h-4 w-4" strokeWidth={2.6} aria-hidden="true" />}
      {children}
    </button>
  );
}

type TagTone = "blaze" | "juniper" | "sky" | "neutral" | "glass";

const TAG_TONE: Record<TagTone, string> = {
  blaze: "bg-brand-light text-brand-dark",
  juniper: "bg-juniper-tint text-juniper",
  sky: "bg-sky-tint text-link",
  neutral: "bg-divider text-themed-text",
  glass: "bg-white/95 text-themed-text",
};

export function Tag({ tone = "neutral", className, children }: { tone?: TagTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-[11px] py-[5px] text-[13px] font-semibold", TAG_TONE[tone], className)}>
      {children}
    </span>
  );
}
