"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import { PrimerContent } from "./primer-content";
import type { Find } from "@/lib/play/play-types";

const LABEL = "text-sm font-bold uppercase tracking-[0.04em] text-juniper-deep";
const HEADING = "m-0 font-[family-name:var(--font-display)] text-[26px] font-semibold leading-[1.2]";

interface PrimeStepProps {
  stopNumber: number;
  primer: NonNullable<Find["primers"]>;
  onReady: () => void;
  /** Error banner for this stop, shown inside the sheet so it isn't dimmed. */
  errorSlot?: ReactNode;
}

/** "Before you start" primer, in a sheet over the map. */
export function PrimeStep({ stopNumber, primer, onReady, errorSlot }: PrimeStepProps) {
  return (
    <BottomSheet label={`Stop ${stopNumber}: before you start`} top="max(88px, 20dvh)" className="overflow-y-auto text-ink">
      {errorSlot}
      <span className={LABEL}>Stop {stopNumber} · Before you start</span>
      <h2 className={HEADING}>{primer.title}</h2>
      <div className="text-lg [&_li]:text-lg [&_p]:text-lg [&_p]:text-ink [&_ul]:text-ink">
        <PrimerContent content={primer.content} />
      </div>
      <div className="min-h-2 flex-1" />
      <Button size="xl" block onClick={onReady}>
        I&apos;m ready
      </Button>
    </BottomSheet>
  );
}

interface ReadingCheckStepProps {
  stopNumber: number;
  readingCheck: NonNullable<Find["reading_check"]>;
  onPassed: () => void;
  onError: (message: string) => void;
  errorSlot?: ReactNode;
}

/** Comprehension check on the primer; 75% to continue. */
export function ReadingCheckStep({ stopNumber, readingCheck, onPassed, onError, errorSlot }: ReadingCheckStepProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const questions = readingCheck.questions;
  const allAnswered = Object.keys(answers).length >= (questions?.length || 0);

  function check() {
    const correct = questions.filter((q, i) => answers[i] === q.correct_answer).length;
    const pct = Math.round((correct / questions.length) * 100);
    if (pct >= 75) {
      onPassed();
    } else {
      onError(`You got ${correct}/${questions.length} correct (${pct}%). Need 75% to continue. Try again!`);
      setAnswers({});
    }
  }

  return (
    <BottomSheet label={`Stop ${stopNumber}: comprehension check`} top="max(88px, 16dvh)" className="overflow-y-auto text-ink">
      {errorSlot}
      <span className={LABEL}>Stop {stopNumber} · Comprehension check</span>
      <p className="text-lg">Answer these questions about the primer before continuing.</p>

      {questions.map((q, qi) => (
        <fieldset key={qi} className="flex flex-col gap-2.5">
          <legend className="mb-2.5 font-[family-name:var(--font-display)] text-[22px] font-semibold leading-snug">
            {qi + 1}. {q.question}
          </legend>
          {q.options.map((opt, oi) => {
            const selected = answers[qi] === opt;
            return (
              <button
                key={oi}
                type="button"
                aria-pressed={selected}
                onClick={() => setAnswers({ ...answers, [qi]: opt })}
                className={cn(
                  "flex min-h-[60px] w-full items-center justify-between gap-3 rounded-2xl bg-white px-[18px] py-3 text-left text-lg text-ink transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                  selected ? "border-2 border-ink font-bold" : "border border-themed-border font-medium hover:border-ink/40"
                )}
              >
                <span className="min-w-0">{opt}</span>
                {selected ? (
                  <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-ink text-white" aria-hidden="true">
                    <Check className="h-4 w-4" strokeWidth={3} />
                  </span>
                ) : (
                  <span className="h-[26px] w-[26px] shrink-0 rounded-full border-2 border-grabber" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </fieldset>
      ))}

      <Button size="xl" block onClick={check} disabled={!allAnswered}>
        {allAnswered ? "Check answers" : "Answer every question"}
      </Button>
    </BottomSheet>
  );
}
