"use client";

import { AnimatePresence, motion } from "framer-motion";
import { DURATION, EASE_IN, EASE_OUT } from "@/lib/motion";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";

interface CollapseProps {
  open: boolean;
  children: React.ReactNode;
}

/**
 * Disclosure body that eases open and closed. Height is the one layout
 * property we animate anywhere: it is brief, user-initiated, and scoped to
 * one region. Children only mount while open, same as `{open && ...}`.
 */
export function Collapse({ open, children }: CollapseProps) {
  // MotionConfig's reducedMotion only drops transforms; height would still tween.
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return open ? <div>{children}</div> : null;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="collapse"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { duration: DURATION.slow, ease: EASE_OUT } }}
          exit={{ height: 0, opacity: 0, transition: { duration: DURATION.base, ease: EASE_IN } }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
