"use client";

import { forwardRef } from "react";
import { m } from "framer-motion";
import type { OnboardingStep } from "@/lib/onboarding/steps";
import type { AnchorRect } from "./use-tour-anchor";

const GAP = 12;
const SPOT_PAD = 6;

interface TourCardProps {
  step: OnboardingStep;
  index: number;
  total: number;
  finalCta: string;
  /** Spotlit element, or null for a centered card. */
  rect: AnchorRect | null;
  reducedMotion: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

/** Card above the spotlight when the target sits in the lower half, else below. */
function cardPosition(rect: AnchorRect): React.CSSProperties {
  const viewport = window.innerHeight;
  if (rect.top + rect.height / 2 > viewport / 2) {
    return { bottom: Math.max(GAP, viewport - rect.top + SPOT_PAD + GAP) };
  }
  return { top: Math.min(viewport - 200, rect.top + rect.height + SPOT_PAD + GAP) };
}

/** The dimmed backdrop with a lit cut-out around the spotlit element. */
export function TourSpotlight({ rect, reducedMotion }: { rect: AnchorRect | null; reducedMotion: boolean }) {
  if (!rect) {
    return <div className="absolute inset-0 bg-[var(--color-text,#111827)]/55 backdrop-blur-[2px]" aria-hidden="true" />;
  }
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute rounded-2xl ring-2 ring-white/90"
      style={{
        top: rect.top - SPOT_PAD,
        left: rect.left - SPOT_PAD,
        width: rect.width + SPOT_PAD * 2,
        height: rect.height + SPOT_PAD * 2,
        boxShadow: "0 0 0 9999px rgb(17 24 39 / 0.55)",
        transition: reducedMotion ? undefined : "top 220ms ease, left 220ms ease, width 220ms ease, height 220ms ease",
      }}
    />
  );
}

/** One step of the welcome tour: what this part of the app is, plus Back / Next / Skip. */
export const TourCard = forwardRef<HTMLDivElement, TourCardProps>(function TourCard(
  { step, index, total, finalCta, rect, reducedMotion, onBack, onNext, onSkip },
  ref
) {
  const isLast = index === total - 1;
  const placement: React.CSSProperties = rect ? cardPosition(rect) : { top: "50%", transform: "translateY(-50%)" };

  return (
    <div className="absolute inset-x-4 mx-auto max-w-sm" style={placement}>
      <m.div
        ref={ref}
        key={step.id}
        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="overflow-hidden rounded-3xl bg-[var(--color-surface,#fff)] shadow-2xl ring-1 ring-themed-border"
      >
        <div className="px-6 pb-5 pt-5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-light text-2xl"
            >
              {step.icon}
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-themed-muted">
                {index + 1} of {total}
              </p>
              <h2 id="tour-step-title" className="font-[family-name:var(--font-display)] text-xl font-bold text-themed-text">
                {step.title}
              </h2>
            </div>
          </div>
          <p className="mt-3 text-[15px] leading-relaxed text-themed-muted">{step.body}</p>

          <div className="mt-4 mb-4 flex justify-center gap-1.5" aria-hidden="true">
            {Array.from({ length: total }, (_, i) => (
              <div
                key={i}
                className={`h-1.5 rounded-full transition-[width,background-color] duration-300 ${
                  i === index ? "w-6 bg-brand" : i < index ? "w-2 bg-brand/60" : "w-2 bg-themed-border"
                }`}
              />
            ))}
          </div>

          <div className="flex gap-3">
            {index > 0 && (
              <button
                onClick={onBack}
                className="min-h-11 flex-1 rounded-xl border border-themed-border px-4 py-2.5 text-sm font-medium text-themed-muted transition-colors hover:bg-themed-bg"
              >
                Back
              </button>
            )}
            <button
              onClick={onNext}
              className="min-h-11 flex-1 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-dark active:scale-[0.98]"
            >
              {isLast ? finalCta : "Next"}
            </button>
          </div>

          {!isLast && (
            <button
              onClick={onSkip}
              className="mt-2 block min-h-11 w-full text-center text-xs text-themed-muted hover:text-themed-text"
            >
              Skip the tour
            </button>
          )}
        </div>
      </m.div>
    </div>
  );
});
