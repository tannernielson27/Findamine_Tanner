import { Shuffle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface ShuffleBadgeProps {
  /** "pill" for page chrome, "compact" for tight spots like the play HUD. */
  variant?: "pill" | "compact";
  className?: string;
}

/**
 * Marks a hunt whose stops come in a random order for each player
 * (hunt metadata `shuffle_stops`, see lib/play/stop-order).
 */
export function ShuffleBadge({ variant = "pill", className }: ShuffleBadgeProps) {
  if (variant === "compact") {
    return (
      <span
        className={cn("inline-flex items-center gap-1 text-[12px] font-semibold text-themed-muted", className)}
        title="Stops come in a random order for each player"
      >
        <Shuffle className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
        Shuffled
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-sky-tint px-[11px] py-[5px] text-[13px] font-semibold text-link",
        className
      )}
      title="Stops come in a random order for each player"
    >
      <Shuffle className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
      Shuffled order
    </span>
  );
}
