"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { ReportProblem } from "@/components/play/report-problem";

interface PlayMoreMenuProps {
  /** Go back one stop; null on the first stop (shown disabled, as before). */
  onPrevious: (() => void) | null;
  /** The stop to report, or the hunt when there is no stop. */
  reportTargetId: string;
}

/**
 * HUD overflow ("More"): Previous stop and Report a problem, reachable at
 * every step like they were on the old play page. A disclosure panel, not an
 * ARIA menu, because it holds the inline report form. Focus moves into the
 * panel on open; Escape or a tap outside closes it and returns focus.
 */
export function PlayMoreMenu({ onPrevious, reportTargetId }: PlayMoreMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();

    const close = (returnFocus: boolean) => {
      setOpen(false);
      if (returnFocus) triggerRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  function goPrevious() {
    if (!onPrevious) return;
    setOpen(false);
    onPrevious();
  }

  return (
    <div ref={rootRef} className="relative shrink-0">
      <IconButton
        ref={triggerRef}
        label="More options"
        tone="floating"
        size="lg"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="bg-white text-ink"
      >
        <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden="true" />
      </IconButton>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-label="More options"
          className="absolute right-0 top-full z-10 mt-2 flex w-[min(320px,calc(100vw-32px))] flex-col gap-1 rounded-2xl border border-themed-border bg-white p-2 text-ink shadow-raised"
        >
          <button
            type="button"
            onClick={goPrevious}
            disabled={!onPrevious}
            className="flex min-h-12 w-full items-center gap-2 rounded-xl px-3 text-left text-base font-semibold transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            Previous stop
          </button>
          <div className="border-t border-themed-border pt-1">
            <ReportProblem key={reportTargetId} targetId={reportTargetId} />
          </div>
        </div>
      )}
    </div>
  );
}
