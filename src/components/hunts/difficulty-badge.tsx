import { Map, ScrollText, Thermometer, type LucideIcon } from "lucide-react";
import {
  NAVIGATION_HELP_LABELS,
  NAVIGATION_HELP_PLAYER_DESCRIPTIONS,
  type NavigationHelp,
} from "@/lib/play/navigation-help";
import { cn } from "@/lib/utils/cn";

/** The most help each level still gives: a map, a meter, or the clue alone. */
const LEVEL_ICON: Record<NavigationHelp, LucideIcon> = {
  easy: Map,
  medium: Thermometer,
  hard: ScrollText,
};

const LEVEL_TONE: Record<NavigationHelp, string> = {
  easy: "bg-juniper-tint text-juniper",
  medium: "bg-sky-tint text-link",
  hard: "bg-brand-light text-brand-dark",
};

interface DifficultyBadgeProps {
  level: NavigationHelp;
  className?: string;
}

/** A hunt's difficulty (lib/play/navigation-help) as a pill. Server-safe. */
export function DifficultyBadge({ level, className }: DifficultyBadgeProps) {
  const Icon = LEVEL_ICON[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-[11px] py-[5px] text-[13px] font-semibold",
        LEVEL_TONE[level],
        className
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" />
      <span className="sr-only">Difficulty: </span>
      {NAVIGATION_HELP_LABELS[level]}
    </span>
  );
}

/**
 * What the hunt's difficulty means for the player, for the hunt page: the
 * level and one plain line about the help they will and won't get.
 */
export function DifficultySummary({ level }: { level: NavigationHelp }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <DifficultyBadge level={level} />
      <p className="min-w-0 flex-1 basis-56 text-base leading-[1.55] text-themed-text">
        {NAVIGATION_HELP_PLAYER_DESCRIPTIONS[level]}
      </p>
    </div>
  );
}
