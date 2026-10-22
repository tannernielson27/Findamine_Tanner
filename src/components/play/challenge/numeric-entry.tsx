"use client";

import { FIELD_CLASS, QuestionText, SubmitButton } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

export function NumericEntry({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  showQuestion = true,
}: ChallengeFieldProps) {
  const question = questionOf(content);
  const unit = (content.unit as string) || "";
  const placeholder = (content.placeholder as string) || "Enter a number...";

  return (
    <div className="flex flex-col gap-4">
      <QuestionText show={showQuestion}>{question}</QuestionText>
      <div className="flex gap-2">
        <input
          type="number"
          inputMode="decimal"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={question || "Enter your numeric answer"}
          className={`${FIELD_CLASS} min-h-[60px] min-w-0 flex-1 tabular-nums`}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        {unit && <span className="flex items-center px-2 text-lg font-semibold text-ink">{unit}</span>}
      </div>
      <SubmitButton ready={!!answer} disabled={disabled} onClick={onSubmit} label="Submit answer" waitingLabel="Enter a number" />
    </div>
  );
}
