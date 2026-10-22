"use client";

import type { ReactNode } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils/cn";

interface PlaySheetProps {
  label: string;
  /** Preferred top edge as a share of the viewport height (dvh). */
  topDvh: number;
  className?: string;
  children?: ReactNode;
}

/**
 * A play step (primer, reading check, challenge) in a sheet over the map.
 *
 * Non-modal on purpose: no backdrop, and it sits inside the play screen's
 * stacking context below the HUD (z-10), so Pause, the clue hint and the
 * "More" menu (Previous stop, Report a problem) stay tappable at every step.
 * Its top edge always clears the HUD (12px gap + 52px HUD + the notch), and
 * focus moves into the sheet when it opens.
 */
export function PlaySheet({ label, topDvh, className, children }: PlaySheetProps) {
  return (
    <BottomSheet
      modal={false}
      autoFocus
      label={label}
      top={`max(calc(88px + env(safe-area-inset-top)), ${topDvh}dvh)`}
      className={cn("z-[5] overflow-y-auto text-ink", className)}
    >
      {children}
    </BottomSheet>
  );
}
