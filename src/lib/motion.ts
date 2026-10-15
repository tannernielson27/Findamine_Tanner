import type { Transition, Variants } from "framer-motion";

/* ─── Motion tokens ─────────────────────────────────────────────
   One vocabulary for every animated surface, so menus, dialogs and the
   play loop all move the same way. Transform + opacity only (compositor
   friendly). Exits run faster than entrances so dismissal never feels
   like waiting. Reduced motion is handled globally by
   <MotionConfig reducedMotion="user"> in AgeBandProvider: transforms are
   dropped and only the opacity fade remains. */

export const DURATION = {
  fast: 0.12,
  base: 0.18,
  slow: 0.24,
} as const;

/** Expo-style ease-out: quick start, soft landing. Used for entrances. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
/** Gentle ease-in for exits. */
export const EASE_IN = [0.4, 0, 1, 1] as const;

/** Snappy spring for small, physical feedback (icon pops, indicators). */
export const SPRING_SNAPPY: Transition = { type: "spring", stiffness: 500, damping: 34, mass: 0.8 };

/** Anchored popovers and dropdowns (pair with a transform-origin class at the anchor). */
export const popover: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: -4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: { duration: DURATION.fast, ease: EASE_IN } },
};

/** Dimmed backdrop behind a dialog. */
export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
  exit: { opacity: 0, transition: { duration: DURATION.fast, ease: EASE_IN } },
};

/** Dialog panel: rises slightly and settles. */
export const dialog: Variants = {
  hidden: { opacity: 0, scale: 0.98, y: 8 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
  exit: { opacity: 0, scale: 0.98, y: 4, transition: { duration: DURATION.fast, ease: EASE_IN } },
};

/** Step content inside a guided flow; `custom` is the direction (1 forward, -1 back). */
export const flowStep: Variants = {
  hidden: (direction: 1 | -1) => ({ opacity: 0, x: 12 * direction }),
  visible: { opacity: 1, x: 0, transition: { duration: DURATION.slow, ease: EASE_OUT } },
};

export type FlowDirection = 1 | -1;

export interface FlowDirectionState {
  key: string;
  position: number;
  direction: FlowDirection;
}

/**
 * Advances flow-direction bookkeeping. Direction only updates when the step
 * `key` changes, comparing against the position recorded at the previous key
 * change, so intermediate renders (e.g. the stop index moving one render
 * before the step resets) can't flip the direction.
 */
export function nextFlowDirection(prev: FlowDirectionState, key: string, position: number): FlowDirectionState {
  if (key === prev.key) return prev;
  return { key, position, direction: position >= prev.position ? 1 : -1 };
}
