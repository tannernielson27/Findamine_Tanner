"use client";

import { useState } from "react";
import Link from "next/link";
import { Camera, Check, ChevronLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { CountUp } from "@/components/ui/count-up";
import { ProgressSegments } from "@/components/ui/progress";
import { PhotoPicker } from "@/components/native/photo-picker";
import { TechniqueReview } from "@/components/play/technique-review";
import { ReportProblem } from "@/components/play/report-problem";
import { cn } from "@/lib/utils/cn";
import type { AnswerFeedback } from "@/lib/play/play-types";

/** Faint topo rings behind the celebration (decorative). */
const TOPO_RINGS =
  "repeating-radial-gradient(ellipse at 50% 30%, transparent 0 26px, rgba(255,255,255,0.06) 26px 27.5px)";

interface StopResultsProps {
  huntId: string | undefined;
  findId: string | undefined;
  stopNumber: number;
  totalStops: number;
  completedStops: number;
  isLastStop: boolean;
  /** "capture": offer the optional geo-selfie first. "feedback": move on. */
  phase: "capture" | "feedback";
  score: number | null;
  hideScores: boolean;
  feedback: AnswerFeedback | null;
  breakdown: Record<string, number> | null;
  alreadyCompleted: boolean;
  error: string | null;
  /** The privacy notice toast is up: keep the actions clear of it. */
  noticeVisible: boolean;
  uploadingPhoto: boolean;
  finishing: boolean;
  onPhoto: (file: File) => Promise<void>;
  onSkipPhoto: () => void;
  onNext: () => void;
  onFinish: () => void;
  onPrevious: (() => void) | null;
  onDismissError: () => void;
  onError: (message: string) => void;
}

function Breakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const items = [
    { label: "Accuracy", value: breakdown.correctness },
    { label: "Mastery", value: breakdown.masteryBonus },
    { label: "Completion", value: breakdown.completion },
  ];
  return (
    <div className="mt-3 border-t border-white/15 pt-3">
      <dl className="grid grid-cols-3 gap-2 text-center">
        {items.map((item) => (
          <div key={item.label} className="flex flex-col-reverse">
            <dt className="text-sm text-white">{item.label}</dt>
            <dd className="m-0 font-[family-name:var(--font-display)] text-xl font-bold tabular-nums">{item.value}</dd>
          </div>
        ))}
      </dl>
      {/* hintPenalty is the server's total: clue hints plus challenge hints */}
      {breakdown.hintPenalty > 0 && (
        <p className="mt-2 text-center text-sm tabular-nums text-white">Hints used: -{breakdown.hintPenalty} pts</p>
      )}
    </div>
  );
}

/**
 * Full-screen stop-complete celebration on juniper: check, points, the
 * server's feedback, progress, and the next action. Covers the capture step
 * (optional geo-selfie) and the feedback step (head to the next stop).
 */
export function StopResults(props: StopResultsProps) {
  const { stopNumber, totalStops, completedStops, isLastStop, phase, score, hideScores, feedback, breakdown } = props;
  // Once the notice has shown on this screen, keep its space reserved so the
  // buttons don't jump under the player's thumb when it auto-dismisses.
  const [reserveForNotice, setReserveForNotice] = useState(props.noticeVisible);
  if (props.noticeVisible && !reserveForNotice) setReserveForNotice(true);

  return (
    <section
      aria-label={`Stop ${stopNumber} complete`}
      className={cn(
        "absolute inset-0 z-20 flex flex-col items-center overflow-y-auto bg-juniper-deep px-6 text-white",
        "pt-[calc(56px+env(safe-area-inset-top))]",
        reserveForNotice ? "pb-[calc(152px+env(safe-area-inset-bottom))]" : "pb-[calc(24px+env(safe-area-inset-bottom))]"
      )}
      style={{ backgroundImage: TOPO_RINGS }}
    >
      <span className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full bg-juniper-bright text-juniper-deep shadow-[0_0_0_14px_rgba(111,207,151,0.18)]">
        <Check className="h-14 w-14" strokeWidth={3} aria-hidden="true" />
      </span>
      <h1 className="mt-7 text-base font-bold tracking-[0.08em] text-[#D6EFE0]">STOP {stopNumber} COMPLETE</h1>

      {score !== null && !hideScores && (
        <>
          <p className="mt-2 font-[family-name:var(--font-display)] text-[80px] font-bold leading-none tabular-nums">
            +<CountUp value={score} />
          </p>
          <p className="mt-1 text-lg text-[#D6EFE0]">points</p>
        </>
      )}
      {score !== null && hideScores && (
        <>
          <p className="mt-2 font-[family-name:var(--font-display)] text-5xl font-bold">Complete!</p>
          <p className="mt-1 text-lg text-[#D6EFE0]">Great effort on this stop</p>
        </>
      )}
      {score === null && props.alreadyCompleted && (
        <p className="mt-3 text-lg text-[#D6EFE0]">You already completed this stop.</p>
      )}

      {(feedback || breakdown) && (
        <div className="mt-6 w-full rounded-[20px] bg-white/10 px-[18px] py-4">
          {feedback && (
            <>
              <p className="text-lg font-bold">{feedback.main}</p>
              <p className="mt-1 text-base">{feedback.explanation}</p>
              {feedback.next_steps && <p className="mt-2 text-base italic">{feedback.next_steps}</p>}
            </>
          )}
          {breakdown && <Breakdown breakdown={breakdown} />}
        </div>
      )}

      <div className="mt-4 flex w-full flex-col gap-2.5 rounded-[20px] bg-white/10 px-[18px] py-4">
        <span className="text-[15px] font-semibold">
          {completedStops} of {totalStops} stops done
        </span>
        <ProgressSegments total={totalStops} done={completedStops} surface="dark" height={8} />
      </div>

      {score !== null && (
        <div className="mt-4 w-full">
          <TechniqueReview key={props.findId} huntId={props.huntId} onError={props.onError} />
        </div>
      )}

      <div className="min-h-6 flex-1" />

      {props.error && (
        <div role="alert" className="mb-3 flex w-full items-center gap-2 rounded-2xl bg-white py-2 pl-4 pr-2 text-ink">
          <p className="min-w-0 flex-1 text-base font-semibold">{props.error}</p>
          <button
            type="button"
            onClick={props.onDismissError}
            className="min-h-12 shrink-0 rounded-xl px-3 text-base font-bold text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Dismiss
          </button>
        </div>
      )}

      <ResultsActions {...props} isLastStop={isLastStop} phase={phase} />
    </section>
  );
}

function ResultsActions(props: StopResultsProps) {
  const linkClass =
    "inline-flex min-h-12 items-center justify-center rounded-xl px-3 text-base font-semibold text-[#D6EFE0] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50";

  if (props.phase === "capture") {
    return (
      <div className="flex w-full flex-col items-center gap-2">
        {/* Browser file input on the web; native camera (after the camera primer) in the iOS app. */}
        <PhotoPicker
          disabled={props.uploadingPhoto}
          onFile={props.onPhoto}
          className={cn(
            buttonVariants({ variant: "light", size: "xl", block: true }),
            "focus-within:ring-2 focus-within:ring-white focus-within:ring-offset-2 focus-within:ring-offset-juniper-deep",
            props.uploadingPhoto ? "cursor-wait opacity-60" : "cursor-pointer"
          )}
        >
          <Camera className="h-5 w-5" aria-hidden="true" />
          <span aria-live="polite">{props.uploadingPhoto ? "Uploading photo..." : "Take a geo-selfie"}</span>
        </PhotoPicker>
        <button type="button" onClick={props.onSkipPhoto} disabled={props.uploadingPhoto} className={linkClass}>
          Skip photo
        </button>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-2">
      {props.isLastStop ? (
        <Button variant="light" size="xl" block onClick={props.onFinish} disabled={props.finishing}>
          {props.finishing ? "Finishing..." : "Finish hunt"}
        </Button>
      ) : (
        <Button variant="light" size="xl" block onClick={props.onNext}>
          Head to stop {props.stopNumber + 1}
        </Button>
      )}
      <Link href="/dashboard" className={linkClass}>
        Take a break
      </Link>
      <div className="mt-1 flex w-full flex-wrap items-center justify-center gap-x-4">
        {props.onPrevious && (
          <button type="button" onClick={props.onPrevious} className={linkClass}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Previous stop
          </button>
        )}
      </div>
      <div className="w-full">
        <ReportProblem key={props.findId} targetId={props.findId || String(props.huntId)} tone="dark" />
      </div>
    </div>
  );
}
