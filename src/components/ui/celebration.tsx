"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import ReactConfetti from "react-confetti";
import { motion, AnimatePresence } from "framer-motion";
import { useAgeBand } from "@/lib/themes/age-band-provider";
import { useReducedMotion } from "@/lib/hooks/use-reduced-motion";
import type { CelebrationIntensity } from "@/lib/play/celebration";

interface CelebrationProps {
  show: boolean;
  message?: string;
  /** Optional second line — e.g. the points just earned ("+120 points"). */
  subMessage?: string;
  /** Scales the confetti burst. Defaults to "medium". */
  intensity?: CelebrationIntensity;
  onComplete?: () => void;
  duration?: number;
}

const confettiColors = {
  primary: ["#F59E0B", "#EF4444", "#10B981", "#8B5CF6", "#EC4899", "#3B82F6"],
  intermediate: ["#0EA5E9", "#14B8A6", "#F59E0B", "#8B5CF6"],
  teen: ["#6366F1", "#EC4899", "#0F766E"],
  adult: ["#1E40AF", "#059669"],
};

const INTENSITY_SCALE: Record<CelebrationIntensity, number> = {
  high: 1.5,
  medium: 1,
  low: 0.5,
};

function subscribeToResize(onChange: () => void): () => void {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}
const getViewportWidth = () => window.innerWidth;
const getViewportHeight = () => window.innerHeight;
const noViewportOnServer = () => 0;

export function Celebration({
  show,
  message,
  subMessage,
  intensity = "medium",
  onComplete,
  duration = 3000,
}: CelebrationProps) {
  const { band } = useAgeBand();
  const reducedMotion = useReducedMotion();
  // Viewport size for the confetti canvas (0 on the server and while hydrating).
  const width = useSyncExternalStore(subscribeToResize, getViewportWidth, noViewportOnServer);
  const height = useSyncExternalStore(subscribeToResize, getViewportHeight, noViewportOnServer);
  const [showConfetti, setShowConfetti] = useState(false);

  // Start the burst when `show` turns on (state adjusted during render, not in
  // an effect); the timer below ends it.
  const [prevShow, setPrevShow] = useState(false);
  if (show !== prevShow) {
    setPrevShow(show);
    if (show) setShowConfetti(true);
  }

  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => {
      setShowConfetti(false);
      onComplete?.();
    }, duration);
    return () => clearTimeout(timer);
  }, [show, duration, onComplete, reducedMotion]);

  // Adults (and reduced-motion users) get a quiet toast instead of a full burst.
  if (band === "adult" || reducedMotion) {
    return (
      <AnimatePresence>
        {show && message && (
          <motion.div
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="fixed top-4 right-4 z-[60] rounded-lg bg-[var(--color-success)] px-4 py-2.5 text-white shadow-lg"
          >
            <p className="text-sm font-semibold">{message}</p>
            {subMessage && <p className="text-xs opacity-90">{subMessage}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  const bandBase = band === "primary" ? 300 : band === "intermediate" ? 150 : 50;
  const confettiCount = Math.round(bandBase * INTENSITY_SCALE[intensity]);
  const gravity = band === "primary" ? 0.15 : 0.25;

  return (
    <>
      {showConfetti && width > 0 && (
        <ReactConfetti
          width={width}
          height={height}
          numberOfPieces={confettiCount}
          gravity={gravity}
          colors={confettiColors[band]}
          recycle={false}
          style={{ position: "fixed", top: 0, left: 0, zIndex: 100 }}
        />
      )}
      <AnimatePresence>
        {show && message && (
          <motion.div
            initial={band === "primary"
              ? { scale: 0, rotate: -15 }
              : { opacity: 0, y: 30 }
            }
            animate={band === "primary"
              ? { scale: 1, rotate: 0, transition: { type: "spring" as const, stiffness: 200, damping: 10 } }
              : { opacity: 1, y: 0 }
            }
            exit={{ opacity: 0, scale: 0.8 }}
            className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none ${
              band === "primary" ? "p-8" : "p-4"
            }`}
          >
            <div className={`bg-white shadow-2xl text-center pointer-events-auto ${
              band === "primary"
                ? "rounded-3xl p-8 border-4 border-[var(--color-primary)]"
                : band === "intermediate"
                ? "rounded-2xl p-6 border-2 border-[var(--color-primary)]"
                : "rounded-xl p-4 border border-[var(--color-primary)]"
            }`}>
              {band === "primary" && (
                <div className="text-5xl mb-3">{intensity === "high" ? "🌟" : "🎉"}</div>
              )}
              <p className={`font-[family-name:var(--font-display)] font-bold text-[var(--color-text)] ${
                band === "primary" ? "text-2xl" :
                band === "intermediate" ? "text-xl" : "text-lg"
              }`}>
                {message}
              </p>
              {subMessage && (
                <p className="font-[family-name:var(--font-handwritten)] text-2xl text-[var(--color-primary-dark,#0284C7)] mt-1">
                  {subMessage}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
