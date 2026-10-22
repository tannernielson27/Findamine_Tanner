"use client";

import { useEffect, useState } from "react";

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface AnchorState {
  rect: AnchorRect | null;
  /** True once the anchor was found, or the wait gave up (show a centered card). */
  settled: boolean;
}

/** How long to wait for a page to render its anchor before falling back. */
const ANCHOR_TIMEOUT_MS = 4000;
const POLL_MS = 100;
const IDLE: AnchorState = { rect: null, settled: true };
const WAITING: AnchorState = { rect: null, settled: false };

/**
 * The same anchor can exist twice (bottom tab bar on phones, top nav on
 * desktop) with one of them display:none. Use the one that is on screen.
 */
function findVisible(anchor: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour-anchor="${CSS.escape(anchor)}"]`);
  for (const node of nodes) {
    const r = node.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return node;
  }
  return null;
}

function toRect(el: HTMLElement): AnchorRect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

/**
 * Viewport rect of the element carrying `data-tour-anchor={anchor}`, tracked
 * through scroll and resize. Waits for the element to appear (the tour often
 * navigates first), scrolls it into view once, and settles with `rect: null`
 * if it never shows up. `stepKey` restarts the wait for each step.
 */
export function useTourAnchor(anchor: string | undefined, stepKey: string, enabled: boolean): AnchorState {
  // Tagged with the step it was measured for, so a new step reads as "waiting"
  // without resetting state inside the effect.
  const [state, setState] = useState<AnchorState & { key: string }>({ ...WAITING, key: "" });

  useEffect(() => {
    if (!enabled || !anchor) return;
    let el: HTMLElement | null = null;
    let frame = 0;
    const started = Date.now();

    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el?.isConnected) setState({ rect: toRect(el), settled: true, key: stepKey });
      });
    };

    const poll = window.setInterval(() => {
      const found = findVisible(anchor);
      if (found) {
        window.clearInterval(poll);
        el = found;
        el.scrollIntoView({ block: "center", behavior: "auto" });
        measure();
      } else if (Date.now() - started > ANCHOR_TIMEOUT_MS) {
        window.clearInterval(poll);
        setState({ ...IDLE, key: stepKey });
      }
    }, POLL_MS);

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearInterval(poll);
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, stepKey, enabled]);

  if (!enabled || !anchor) return IDLE;
  return state.key === stepKey ? { rect: state.rect, settled: state.settled } : WAITING;
}
