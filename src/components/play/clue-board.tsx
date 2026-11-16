"use client";

import { CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { Find } from "@/lib/play/play-types";
import { cn } from "@/lib/utils/cn";

interface ClueBoardProps {
  finds: ReadonlyArray<Find>;
  completedFinds: ReadonlySet<string>;
  /** The clue the player is working on now, if any. */
  activeId: string | null;
  onPick: (findId: string) => void;
  /** Close and keep the active clue; null when there is no open clue to go back to. */
  onClose: (() => void) | null;
}

/**
 * "All clues at once" hunts: every unfinished clue, and the player picks the
 * one to work on. The map, hot/cold and arrival all follow the active clue;
 * the player can come back here and switch at any time.
 */
export function ClueBoard({ finds, completedFinds, activeId, onPick, onClose }: ClueBoardProps) {
  const open = finds.filter((f) => !completedFinds.has(f.id));
  const doneCount = finds.length - open.length;

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="clue-board-heading"
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[82%] flex-col rounded-t-[28px] bg-white text-ink shadow-raised pb-[env(safe-area-inset-bottom)]"
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h2 id="clue-board-heading" className="text-lg font-bold">
            Choose a clue
          </h2>
          <p className="text-sm text-themed-muted">
            {open.length} open · {doneCount} of {finds.length} found. Pick one to work on; you can switch any time.
          </p>
        </div>
        {onClose && (
          <IconButton label="Back to the active clue" tone="floating" onClick={onClose} className="bg-white text-ink">
            <X className="h-5 w-5" aria-hidden="true" />
          </IconButton>
        )}
      </header>

      <ul className="flex flex-col gap-2.5 overflow-y-auto px-5 pb-5">
        {open.map((find) => {
          const active = find.id === activeId;
          return (
            <li
              key={find.id}
              className={cn(
                "rounded-[18px] border p-4",
                active ? "border-brand bg-sky-tint" : "border-themed-border bg-surface"
              )}
            >
              <p className="text-[15px] leading-snug">{find.clue_text || "No written clue: follow the map."}</p>
              <Button
                size="md"
                variant={active ? "ink" : "secondary"}
                className="mt-3"
                onClick={() => onPick(find.id)}
                aria-label={active ? "Keep working on this clue" : "Work on this clue"}
              >
                {active ? "Keep working on this" : "Work on this clue"}
              </Button>
            </li>
          );
        })}
        {open.length === 0 && (
          <li className="flex items-center gap-2 text-sm text-themed-muted">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Every clue is found.
          </li>
        )}
      </ul>
    </section>
  );
}
