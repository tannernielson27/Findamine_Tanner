import { LayoutList, ListOrdered, Shuffle } from "lucide-react";
import type { ClueDelivery } from "@/lib/play/clue-delivery";
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

const DELIVERY_BADGE: Partial<Record<ClueDelivery, { pill: string; compact: string; title: string }>> = {
  all_at_once: { pill: "All clues at once", compact: "Any order", title: "Every stop is open; players choose which to work on" },
  assigned_order: { pill: "Assigned orders", compact: "Assigned", title: "Each player is assigned one of several stop orders" },
};

interface ClueDeliveryBadgeProps extends ShuffleBadgeProps {
  mode: ClueDelivery;
}

/**
 * Marks how a hunt hands out clues (lib/play/clue-delivery). Nothing for the
 * creator's fixed order; random order keeps the "Shuffled" badge above.
 */
export function ClueDeliveryBadge({ mode, variant = "pill", className }: ClueDeliveryBadgeProps) {
  if (mode === "random_order") return <ShuffleBadge variant={variant} className={className} />;
  const copy = DELIVERY_BADGE[mode];
  if (!copy) return null;
  const Icon = mode === "all_at_once" ? LayoutList : ListOrdered;
  return (
    <span
      className={cn(
        variant === "compact"
          ? "inline-flex items-center gap-1 text-[12px] font-semibold text-themed-muted"
          : "inline-flex items-center gap-1 rounded-full bg-sky-tint px-[11px] py-[5px] text-[13px] font-semibold text-link",
        className
      )}
      title={copy.title}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
      {variant === "compact" ? copy.compact : copy.pill}
    </span>
  );
}
