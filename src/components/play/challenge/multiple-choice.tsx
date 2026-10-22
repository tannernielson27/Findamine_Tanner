"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { QuestionText, SubmitButton } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

export function MultipleChoice({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  showQuestion = true,
}: ChallengeFieldProps) {
  const options = (content.options as string[]) || [];
  const question = questionOf(content);

  return (
    <div className="flex flex-col gap-4">
      <QuestionText show={showQuestion}>{question}</QuestionText>
      <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={question || "Answer options"}>
        {options.map((option, idx) => {
          const isSelected = answer === option;
          return (
            <button
              key={idx}
              type="button"
              role="radio"
              aria-checked={isSelected}
              onClick={() => onAnswerChange(option)}
              disabled={disabled}
              className={cn(
                "flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl bg-white px-[18px] py-3 text-left text-lg text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50",
                isSelected ? "border-2 border-ink font-bold" : "border border-themed-border font-medium hover:border-ink/40"
              )}
            >
              <span className="min-w-0">{option}</span>
              {isSelected ? (
                <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-hidden="true">
                  <Check className="h-4 w-4" strokeWidth={3} />
                </span>
              ) : (
                <span className="h-[26px] w-[26px] shrink-0 rounded-full border-2 border-grabber" aria-hidden="true" />
              )}
            </button>
          );
        })}
      </div>
      <SubmitButton ready={!!answer} disabled={disabled} onClick={onSubmit} label="Submit answer" waitingLabel="Pick an answer" />
    </div>
  );
}
