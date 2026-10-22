"use client";

import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { flowStep } from "@/lib/motion";
import { useFlowDirection } from "@/lib/hooks/use-flow-direction";
import StopFlowStepper from "@/components/play/stop-flow-stepper";
import { CountUp } from "@/components/ui/count-up";
import { ReportProblem } from "@/components/play/report-problem";
import { PrimeStep, ReadingCheckStep } from "./steps/prime-step";
import { ClueStep } from "./steps/clue-step";
import { NavigateStep } from "./steps/navigate-step";
import { ChallengeStep } from "./steps/challenge-step";
import { CaptureStep } from "./steps/capture-step";
import { FeedbackStep } from "./steps/feedback-step";
import { STEP_ORDER } from "@/lib/play/play-types";
import type { PlaySession } from "@/lib/play/use-play-session";
import type { StopFlow } from "@/lib/play/use-stop-flow";

const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 flex-1 sm:ml-auto sm:w-auto sm:flex-none sm:px-8";

interface ActivePlayProps {
  huntId: string | undefined;
  session: PlaySession;
  flow: StopFlow;
}

/** The in-hunt view: progress, the current step, and stop navigation. */
export function ActivePlay({ huntId, session, flow }: ActivePlayProps) {
  const { finds, currentIndex, completedFinds, sessionScore, huntMeta } = session;
  const { step, error, setError } = flow;
  const currentFind = finds[currentIndex];
  const totalCompleted = completedFinds.size;
  const isLastFind = currentIndex === finds.length - 1;
  const flowDirection = useFlowDirection(step, currentIndex * 10 + STEP_ORDER[step]);

  return (
    <>
      {/* Error banner */}
      {error && (
        <div role="alert" className="rounded-lg bg-error/10 border border-error/30 py-2 pl-4 pr-2 mb-4 flex justify-between items-center gap-2">
          <p className="text-base text-error">{error}</p>
          <button onClick={() => setError(null)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-error hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error">
            Dismiss
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 mb-2">
        <span className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-themed-text">
          Stop {currentIndex + 1} of {finds.length}
        </span>
        <div className="flex items-center gap-3">
          {!huntMeta.hide_scores && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2.5 py-0.5 font-[family-name:var(--font-display)] text-base font-bold text-secondary tabular-nums"
              aria-label={`${sessionScore} points so far`}
            >
              <Star className="h-4 w-4" aria-hidden="true" />
              <CountUp value={sessionScore} />
            </span>
          )}
          <span className="font-[family-name:var(--font-handwritten)] text-xl tabular-nums text-secondary">
            {totalCompleted}/{finds.length} done
          </span>
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-themed-border mb-5 overflow-hidden" role="progressbar" aria-valuenow={totalCompleted} aria-valuemin={0} aria-valuemax={finds.length} aria-label={`Hunt progress: ${totalCompleted} of ${finds.length} stops completed`}>
        <div
          className="h-2.5 rounded-full bg-secondary transition-transform duration-500 ease-out"
          style={{ transform: `translateX(-${100 - (totalCompleted / finds.length) * 100}%)` }}
        />
      </div>

      <StopFlowStepper currentStep={step} />

      <div className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] mb-4 min-h-[300px] p-4 sm:p-5 overflow-hidden" aria-live="polite">
        {/* Keyed on step only: a stop change alone (same step) must not remount
            the map or challenge mid-transition. Entrance only, so content is
            interactive immediately. */}
        <motion.div key={step} custom={flowDirection} variants={flowStep} initial="hidden" animate="visible">
          {step === "prime" && currentFind?.primers && (
            <PrimeStep primer={currentFind.primers} onReady={flow.handlePrimeViewed} />
          )}
          {step === "reading_check" && currentFind?.reading_check && (
            <ReadingCheckStep
              readingCheck={currentFind.reading_check}
              onPassed={flow.handleReadingCheckPassed}
              onError={setError}
            />
          )}
          {step === "clue" && (
            <ClueStep find={currentFind} hints={flow.hints} onStartNavigating={flow.handleClueRead} />
          )}
          {step === "navigate" && <NavigateStep find={currentFind} flow={flow} />}
          {step === "challenge" && <ChallengeStep huntId={huntId} find={currentFind} flow={flow} />}
          {step === "capture" && (
            <CaptureStep uploading={flow.uploadingPhoto} onFile={flow.handleCapturePhoto} onSkip={flow.handleCaptureSkip} />
          )}
          {step === "feedback" && (
            <FeedbackStep
              huntId={huntId}
              findId={currentFind?.id}
              score={flow.score}
              hideScores={!!huntMeta.hide_scores}
              feedback={flow.feedback}
              breakdown={flow.breakdown}
              alreadyCompleted={completedFinds.has(currentFind?.id || "")}
              onError={setError}
            />
          )}
        </motion.div>
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-3">
        <button
          onClick={flow.handlePreviousFind}
          disabled={currentIndex === 0}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 shrink-0 px-5"
        >
          Previous
        </button>

        {step === "feedback" && (
          isLastFind ? (
            <button onClick={flow.handleFinishHunt} disabled={flow.finishing} className={PRIMARY}>
              {flow.finishing ? "Finishing..." : "Finish Hunt"}
            </button>
          ) : (
            <button onClick={flow.handleNextFind} className={PRIMARY}>
              Next Stop
            </button>
          )
        )}
      </div>

      <ReportProblem key={currentFind?.id} targetId={currentFind?.id || String(huntId)} />
    </>
  );
}
