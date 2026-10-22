"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { QuestionText, SubmitButton } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

const MOVE_CLASS =
  "flex h-12 w-12 items-center justify-center rounded-xl text-ink transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-30";

export function SortingOrdering({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  showQuestion = true,
}: ChallengeFieldProps) {
  const items = (content.items as string[]) || [];
  const question = questionOf(content, "Put these in the correct order:");

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
    <div className="flex flex-col gap-4">
      <QuestionText show={showQuestion}>{question}</QuestionText>
      <ol className="flex flex-col gap-2.5">
        {order.map((item, idx) => (
          <li
            key={item}
            className="flex min-h-[60px] items-center gap-2 rounded-2xl border border-themed-border bg-white py-1 pl-4 pr-1 text-lg text-ink"
          >
            <span className="w-7 text-base font-bold tabular-nums">{idx + 1}.</span>
            <span className="min-w-0 flex-1">{item}</span>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => moveItem(idx, idx - 1)}
                disabled={idx === 0 || disabled}
                className={MOVE_CLASS}
                aria-label={`Move ${item} up`}
              >
                <ChevronUp className="h-6 w-6" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => moveItem(idx, idx + 1)}
                disabled={idx === order.length - 1 || disabled}
                className={MOVE_CLASS}
                aria-label={`Move ${item} down`}
              >
                <ChevronDown className="h-6 w-6" aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <SubmitButton ready={!!answer} disabled={disabled} onClick={onSubmit} label="Submit order" waitingLabel="Put them in order" />
    </div>
  );
}
