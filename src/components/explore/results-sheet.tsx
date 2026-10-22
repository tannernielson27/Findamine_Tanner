"use client";

/**
 * Map results sheet with three detents (collapsed / half / full), like the
 * AllTrails and Apple Maps sheets. Drag the handle, or tap / press it to step
 * through the detents. Motion is a translate (compositor-only) and is turned
 * off under reduced motion.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { cn } from "@/lib/utils/cn";

export type SheetDetent = "collapsed" | "half" | "full";

/** Where the sheet's top edge sits when fully open (px from the container top). */
const FULL_TOP = 16;
/** Visible height when collapsed: handle, title, one row card, and room for the tab bar. */
const COLLAPSED_VISIBLE = 300;
const TAP_SLOP = 6;
const ORDER: SheetDetent[] = ["collapsed", "half", "full"];

/** Pixel offset (translateY) of each detent for a container of height `h`. Pure. */
export function detentOffsets(h: number): Record<SheetDetent, number> {
  const max = Math.max(0, h - FULL_TOP - COLLAPSED_VISIBLE);
  return {
    full: 0,
    half: Math.min(max, Math.max(0, Math.round(h * 0.42) - FULL_TOP)),
    collapsed: max,
  };
}

function nearest(offsets: Record<SheetDetent, number>, y: number): SheetDetent {
  return ORDER.reduce((best, d) => (Math.abs(offsets[d] - y) < Math.abs(offsets[best] - y) ? d : best), "collapsed" as SheetDetent);
}

interface ResultsSheetProps {
  title: string;
  subtitle?: string;
  /** Floating control pinned just above the sheet (hidden when the sheet is full). */
  above?: ReactNode;
  /** Always-visible part (selected hunt). */
  header?: ReactNode;
  /** Scrollable list under the header. */
  children?: ReactNode;
  containerHeight: number;
}

export function ResultsSheet({ title, subtitle, above, header, children, containerHeight }: ResultsSheetProps) {
  const [detent, setDetent] = useState<SheetDetent>("collapsed");
  const [dragY, setDragY] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startOffset: number; moved: boolean; lastY: number } | null>(null);
  /** Set when a drag ends, so the click that follows it doesn't also step the detent. */
  const justDragged = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const [listTop, setListTop] = useState(0);

  const offsets = detentOffsets(containerHeight);
  const offset = dragY ?? offsets[detent];
  const visible = Math.max(0, containerHeight - FULL_TOP - offset);

  useEffect(() => {
    if (listRef.current) setListTop(listRef.current.offsetTop);
  }, [header, containerHeight]);

  function onPointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    justDragged.current = false;
    drag.current = { startY: e.clientY, startOffset: offsets[detent], moved: false, lastY: offsets[detent] };
  }

  function onPointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < TAP_SLOP) return;
    d.moved = true;
    d.lastY = Math.min(offsets.collapsed, Math.max(0, d.startOffset + dy));
    setDragY(d.lastY);
  }

  function onPointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      setDetent(nearest(offsets, d.lastY));
      // Swallow only the click this pointerup produces (a cancel produces none).
      if (e.type === "pointerup") {
        justDragged.current = true;
        setTimeout(() => {
          justDragged.current = false;
        }, 0);
      }
    }
    setDragY(null);
  }

  function step() {
    // Click also fires after a drag; only a real tap (or keyboard) steps.
    if (justDragged.current) {
      justDragged.current = false;
      return;
    }
    setDetent((cur) => ORDER[(ORDER.indexOf(cur) + 1) % ORDER.length]);
  }

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ "--fm-sheet-y": `${offset}px` } as CSSProperties}>
      <BottomSheet
        modal={false}
        label="Hunts in this area"
        top={FULL_TOP}
        className={cn(
          "pointer-events-auto translate-y-[var(--fm-sheet-y)] gap-3 px-4 pb-0",
          dragY == null && "transition-[translate] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        )}
      >
        {above && detent !== "full" && dragY == null && (
          <div className="absolute -top-[58px] right-4">{above}</div>
        )}
        <button
          type="button"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={step}
          aria-expanded={detent !== "collapsed"}
          aria-label={`${title}. ${detent === "full" ? "Collapse" : "Expand"} results`}
          className="-mt-6 flex min-h-12 touch-none items-end justify-between gap-3 rounded-xl px-1 pt-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <span aria-hidden="true" className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text">
            {title}
          </span>
          {subtitle && <span aria-hidden="true" className="shrink-0 pb-0.5 text-sm text-themed-muted">{subtitle}</span>}
        </button>
        {header}
        <div
          ref={listRef}
          className="fm-no-scrollbar -mx-4 flex flex-col gap-3 overflow-y-auto overscroll-contain px-4 fm-tab-safe"
          style={{ maxHeight: Math.max(0, visible - listTop) }}
        >
          {children}
        </div>
      </BottomSheet>
    </div>
  );
}
