"use client";

import { useState } from "react";
import { PrimerContent } from "./primer-content";
import type { Find } from "@/lib/play/play-types";

const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";

export function PrimeStep({ primer, onReady }: { primer: NonNullable<Find["primers"]>; onReady: () => void }) {
  return (
    <div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Before You Start</h2>
      <div className="rounded-xl border border-themed-border bg-themed-bg p-4 mb-4">
        <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text mb-2">
          {primer.title}
        </h3>
        <PrimerContent content={primer.content} />
      </div>
      <button onClick={onReady} className={PRIMARY}>
        I&apos;m Ready!
      </button>
    </div>
  );
}

interface ReadingCheckStepProps {
  readingCheck: NonNullable<Find["reading_check"]>;
  onPassed: () => void;
  onError: (message: string) => void;
}

/** Comprehension check on the primer; 75% to continue. */
export function ReadingCheckStep({ readingCheck, onPassed, onError }: ReadingCheckStepProps) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const questions = readingCheck.questions;

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
    <div>
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-2">Comprehension Check</h2>
      <p className="text-base text-themed-muted mb-3">Answer these questions about the primer before continuing.</p>

      <div className="space-y-3 mb-4">
        {questions.map((q, qi) => (
          <div key={qi} className="rounded-xl border border-themed-border bg-surface p-3">
            <p className="text-base font-semibold text-themed-text mb-2">{qi + 1}. {q.question}</p>
            <div className="space-y-2">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  onClick={() => setAnswers({ ...answers, [qi]: opt })}
                  className={`flex min-h-11 w-full items-center text-left rounded-lg border-2 px-3 py-2 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                    answers[qi] === opt
                      ? "border-link bg-link/10 font-semibold text-themed-text"
                      : "border-themed-border bg-surface text-themed-text hover:bg-themed-bg"
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={check}
        disabled={Object.keys(answers).length < (questions?.length || 0)}
        className={PRIMARY}
      >
        Check Answers
      </button>
    </div>
  );
}
