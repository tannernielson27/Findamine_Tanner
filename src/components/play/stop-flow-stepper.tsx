"use client";

import { BookOpen, Camera, Check, Compass, Puzzle, Search, Star } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { SPRING_SNAPPY } from "@/lib/motion";

const STEPS = [
  { key: "prime", label: "Prime", icon: BookOpen },
  { key: "clue", label: "Clue", icon: Search },
  { key: "navigate", label: "Navigate", icon: Compass },
  { key: "challenge", label: "Challenge", icon: Puzzle },
  { key: "capture", label: "Capture", icon: Camera },
  { key: "feedback", label: "Results", icon: Star },
];

interface StopFlowStepperProps {
  currentStep: string;
}

export default function StopFlowStepper({ currentStep }: StopFlowStepperProps) {
  // The reading check quizzes the primer, so it shows as part of the Prime step.
  const stepKey = currentStep === "reading_check" ? "prime" : currentStep;
  const currentIndex = STEPS.findIndex((s) => s.key === stepKey);

  return (
    <nav aria-label="Stop progress" className="mb-6">
      <ol className="flex items-start justify-between gap-1">
        {STEPS.map((step, i) => {
          const isActive = i === currentIndex;
          const isCompleted = i < currentIndex;
          const Icon = isCompleted ? Check : step.icon;

          return (
            <li
              key={step.key}
              aria-current={isActive ? "step" : undefined}
              className="relative flex min-w-0 flex-1 flex-col items-center"
            >
              {/* Connector to the previous step: juniper fills in once that leg is done */}
              {i > 0 && (
                <span aria-hidden="true" className="absolute top-5 right-1/2 h-0.5 w-full -translate-y-1/2 overflow-hidden bg-themed-border">
                  <span
                    className={`block h-full w-full origin-left bg-secondary transition-transform duration-300 ease-out ${
                      i <= currentIndex ? "scale-x-100" : "scale-x-0"
                    }`}
                  />
                </span>
              )}
              <span
                className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200 ${
                  isActive
                    ? "bg-surface text-link"
                    : isCompleted
                    ? "bg-secondary text-white"
                    : "border border-themed-border bg-themed-bg text-themed-muted"
                }`}
              >
                {/* One ring that glides to whichever step is active */}
                {isActive && (
                  <motion.span
                    layoutId="stepper-active-ring"
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full ring-2 ring-link"
                    transition={SPRING_SNAPPY}
                  />
                )}
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={isCompleted ? "done" : "todo"}
                    initial={{ scale: 0.4, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={SPRING_SNAPPY}
                    className="flex"
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </motion.span>
                </AnimatePresence>
              </span>
              <span
                className={`mt-1 max-w-full truncate text-xs sm:text-sm ${
                  isActive
                    ? "font-semibold text-link"
                    : isCompleted
                    ? "text-secondary"
                    : "text-themed-muted"
                }`}
              >
                {step.label}
                {isCompleted && <span className="sr-only"> (done)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
