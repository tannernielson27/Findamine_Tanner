import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Text inputs inside the challenge sheet: 56px+, 18px text, high-contrast border. */
export const FIELD_CLASS =
  "w-full rounded-2xl border-2 border-themed-border bg-white px-4 text-lg text-ink placeholder:text-[#5B6472] focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

/** Secondary text action (retake, clear, record again): 48px tall. */
export const TEXT_ACTION_CLASS =
  "inline-flex min-h-12 items-center gap-1.5 rounded-xl px-3 text-base font-bold text-link transition-colors hover:bg-sky-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50";

export function QuestionText({ show, children }: { show: boolean; children: ReactNode }) {
  if (!show || !children) return null;
  return <p className="mb-3 text-lg text-ink">{children}</p>;
}

interface SubmitButtonProps {
  ready: boolean;
  disabled?: boolean;
  onClick: () => void;
  /** Label once an answer is in ("Submit answer"). */
  label: string;
  /** Label while there's nothing to submit yet ("Pick an answer"). */
  waitingLabel: string;
}

/** The sheet's primary action: 64px, disabled state says what's missing. */
export function SubmitButton({ ready, disabled, onClick, label, waitingLabel }: SubmitButtonProps) {
  return (
    <Button size="xl" block onClick={onClick} disabled={!ready || disabled}>
      {ready ? label : waitingLabel}
    </Button>
  );
}
