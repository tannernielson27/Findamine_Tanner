"use client";

import type { ReactNode } from "react";
import { Lightbulb, ThumbsDown, ThumbsUp } from "lucide-react";
import ChallengeInput from "@/components/play/challenge-input";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { ReportProblem } from "@/components/play/report-problem";
import { questionOf } from "@/components/play/challenge/types";
import type { StopFlow } from "@/lib/play/use-stop-flow";
import type { Find } from "@/lib/play/play-types";

const TYPE_LABELS: Record<string, string> = {
  multiple_choice: "Multiple choice",
  numeric_entry: "Number",
  sorting_ordering: "Put in order",
  photo_observation: "Photo",
  sketch_draw: "Sketch",
  audio_response: "Voice answer",
  short_text: "Short answer",
  creative_writing: "Writing",
  data_collection: "Data collection",
  team_debate: "Team debate",
};

const RATE_CLASS =
  "inline-flex h-12 w-12 items-center justify-center rounded-xl border border-themed-border bg-white text-ink transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

interface ChallengeSheetProps {
  huntId: string | undefined;
  stopNumber: number;
  find: Find | undefined;
  flow: StopFlow;
  /** Error banner for this stop, shown inside the sheet so it isn't dimmed. */
  errorSlot?: ReactNode;
}

/** The stop's challenge, in a bottom sheet over the map so the player keeps their place. */
export function ChallengeSheet({ huntId, stopNumber, find, flow, errorSlot }: ChallengeSheetProps) {
  const { hints, feedback, canRetry, answer, setAnswer, handleSubmitAnswer, submitting } = flow;
  const type = find?.tasks?.challenge_type || "short_text";
  const content = find?.tasks?.content || {};
  const question = questionOf(content);
  const title = find?.tasks?.title || "";
  // The question is the heading when there is one; otherwise the task title is,
  // and the input shows its own default prompt.
  const heading = question || title || "Challenge";
  const showTitleLine = !!question && !!title && title !== question;

  return (
    <BottomSheet label={`Stop ${stopNumber} challenge`} top="max(88px, 24dvh)" className="overflow-y-auto text-ink">
      {errorSlot}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold uppercase tracking-[0.04em] text-juniper-deep">
          Stop {stopNumber} · {TYPE_LABELS[type] ?? "Challenge"}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        {showTitleLine && <p className="text-base font-semibold">{title}</p>}
        <h2 className="m-0 font-[family-name:var(--font-display)] text-[26px] font-semibold leading-[1.2]">{heading}</h2>
      </div>

      {hints.hintText && (
        <div className="rounded-2xl bg-sky-tint p-4">
          <p className="text-base">
            <strong>Hint (Level {hints.hintLevel}):</strong> {hints.hintText}
          </p>
          {!hints.hintRated ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-base" id="hint-helpful-label">Was this helpful?</span>
              <button aria-label="Hint was helpful" aria-describedby="hint-helpful-label" onClick={() => hints.rateHint(1)} className={RATE_CLASS}>
                <ThumbsUp className="h-5 w-5" aria-hidden="true" />
              </button>
              <button aria-label="Hint was not helpful" aria-describedby="hint-helpful-label" onClick={() => hints.rateHint(-1)} className={RATE_CLASS}>
                <ThumbsDown className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <p className="mt-1 text-base">Thanks for the feedback!</p>
          )}
        </div>
      )}

      {/* Feedback from the previous attempt */}
      {feedback && canRetry && (
        <div
          role="status"
          className={`rounded-2xl border-l-4 bg-white p-4 ${
            feedback.type === "correct" ? "border-juniper" : feedback.type === "partial" ? "border-link" : "border-[#9A3412]"
          }`}
        >
          <p className="text-base font-bold">{feedback.main}</p>
          <p className="mt-1 text-base">{feedback.explanation}</p>
        </div>
      )}

      <ChallengeInput
        challengeType={type}
        content={content}
        answer={answer}
        onAnswerChange={setAnswer}
        onSubmit={handleSubmitAnswer}
        disabled={submitting}
        huntId={huntId}
        findId={find?.id}
        showQuestion={!question}
      />
      {submitting && (
        <p role="status" className="-mt-2 text-center text-base">Checking your answer...</p>
      )}

      <Button variant="secondary" size="lg" block onClick={hints.requestHint} disabled={hints.hintLevel >= 4}>
        <Lightbulb className="h-5 w-5" aria-hidden="true" />
        {hints.hintLevel === 0 ? "Need a hint?" : hints.hintLevel < 4 ? `Get more help (Level ${hints.hintLevel + 1})` : "No more hints available"}
      </Button>

      <ReportProblem key={find?.id} targetId={find?.id || String(huntId)} />
    </BottomSheet>
  );
}
