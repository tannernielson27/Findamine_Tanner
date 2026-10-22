"use client";

/**
 * Bottom sheet (HIG-style, one at a time, never stacked).
 *
 * - `modal`: dims the page, traps nothing but moves focus into the sheet,
 *   closes on Escape or a backdrop tap (when `onClose` is given).
 * - non-modal (`modal={false}`): a resting sheet over a map, no backdrop, so
 *   controls outside it (e.g. the play HUD) stay usable. Pass `autoFocus` to
 *   move focus into it when it opens (a step the player must act on).
 *
 * `top` sets where the sheet's top edge sits (px from the viewport top, or
 * any CSS length); the sheet always reaches the bottom of its container.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

interface BottomSheetProps {
  open?: boolean;
  modal?: boolean;
  /** Non-modal only: focus the sheet when it opens. Modal sheets always do. */
  autoFocus?: boolean;
  label: string;
  onClose?: () => void;
  top?: number | string;
  className?: string;
  children: ReactNode;
}

export function BottomSheet({
  open = true,
  modal = true,
  autoFocus = false,
  label,
  onClose,
  top = "26%",
  className,
  children,
}: BottomSheetProps) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || modal || !autoFocus) return;
    ref.current?.focus({ preventScroll: true });
  }, [open, modal, autoFocus]);

  useEffect(() => {
    if (!open || !modal) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [open, modal, onClose]);

  if (!open) return null;

  const sheet = (
    <section
      ref={ref}
      role={modal ? "dialog" : "region"}
      aria-modal={modal || undefined}
      aria-label={label}
      aria-describedby={undefined}
      id={titleId}
      tabIndex={-1}
      className={cn(
        "fm-sheet-in absolute inset-x-0 bottom-0 flex flex-col gap-4 rounded-t-[var(--radius-sheet)] bg-themed-bg px-5 pt-2.5 shadow-[0_-10px_30px_rgb(28_36_48/0.18)] outline-none",
        "pb-[calc(24px+env(safe-area-inset-bottom))]",
        className
      )}
      style={{ top }}
    >
      <span aria-hidden="true" className="h-[5px] w-10 shrink-0 self-center rounded-full bg-grabber" />
      {children}
    </section>
  );

  if (!modal) return sheet;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />
      {sheet}
    </div>
  );
}
