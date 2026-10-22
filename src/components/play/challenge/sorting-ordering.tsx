"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ChallengeFieldProps } from "./types";

export function SortingOrdering({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeFieldProps) {
  const items = (content.items as string[]) || [];
  const question = (content.question as string) || (content.text as string) || "Put these in the correct order:";

  // Parse current order from answer (comma-separated) or initialize shuffled
  const [order, setOrder] = useState<string[]>(() => {
    if (answer) return answer.split(",");
    // Shuffle items for initial display
    return [...items].sort(() => Math.random() - 0.5);
  });

  // The order on screen is the answer even before anything is moved; without
  // this the Submit button stays disabled until the player reorders something.
  useEffect(() => {
    if (!answer && order.length > 0) onAnswerChange(order.join(","));
  }, [answer, order, onAnswerChange]);

  const moveItem = (fromIdx: number, toIdx: number) => {
    if (disabled) return;
    const newOrder = [...order];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, moved);
    setOrder(newOrder);
    onAnswerChange(newOrder.join(","));
  };

  return (
    <div>
      <p className="text-base text-themed-text mb-3">{question}</p>
      <div className="space-y-2 mb-4">
        {order.map((item, idx) => (
          <div
            key={item}
            className="flex items-center gap-2 rounded-lg border border-themed-border bg-surface py-1 pl-4 pr-1 text-base text-themed-text"
          >
            <span className="text-themed-muted text-sm font-semibold tabular-nums w-6">{idx + 1}.</span>
            <span className="min-w-0 flex-1">{item}</span>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={() => moveItem(idx, idx - 1)}
                disabled={idx === 0 || disabled}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-themed-muted transition-colors hover:bg-themed-bg hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30"
                aria-label="Move up"
              >
                <ChevronUp className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                onClick={() => moveItem(idx, idx + 1)}
                disabled={idx === order.length - 1 || disabled}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-themed-muted transition-colors hover:bg-themed-bg hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30"
                aria-label="Move down"
              >
                <ChevronDown className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>
      <button
        onClick={onSubmit}
        disabled={!answer || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Order
      </button>
    </div>
  );
}
