"use client";

import { BookOpen, Camera, Check, Compass, Puzzle, Search, Star } from "lucide-react";

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
  const currentIndex = STEPS.findIndex((s) => s.key === currentStep);

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
              {/* Connector to the previous step: juniper once that leg is done */}
              {i > 0 && (
                <span
                  aria-hidden="true"
                  className={`absolute top-5 right-1/2 h-0.5 w-full -translate-y-1/2 ${
                    i <= currentIndex ? "bg-secondary" : "bg-themed-border"
                  }`}
                />
              )}
              <span
                className={`relative flex h-10 w-10 items-center justify-center rounded-full transition-colors duration-200 ${
                  isActive
                    ? "bg-surface text-link ring-2 ring-link"
                    : isCompleted
                    ? "bg-secondary text-white"
                    : "border border-themed-border bg-themed-bg text-themed-muted"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
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
