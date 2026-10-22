"use client";

import { FIELD_CLASS, QuestionText, SubmitButton } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

export function TextInput({
  challengeType,
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  showQuestion = true,
}: ChallengeFieldProps & { challengeType: string }) {
  const isLongForm = ["creative_writing", "data_collection", "team_debate"].includes(challengeType);
  const question = questionOf(content);

  return (
    <div className="flex flex-col gap-4">
      <QuestionText show={showQuestion}>{question}</QuestionText>
      {isLongForm ? (
        <textarea
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer..."
          disabled={disabled}
          rows={5}
          aria-label={question || "Your answer"}
          className={`${FIELD_CLASS} resize-y py-3`}
        />
      ) : (
        <input
          type="text"
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder="Your answer..."
          disabled={disabled}
          aria-label={question || "Your answer"}
          className={`${FIELD_CLASS} min-h-[60px]`}
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
      )}
      <SubmitButton ready={!!answer} disabled={disabled} onClick={onSubmit} label="Submit answer" waitingLabel="Type your answer" />
    </div>
  );
}
