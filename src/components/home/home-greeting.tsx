"use client";

import { useSyncExternalStore } from "react";
import { greetingFor, timeOfDayLine } from "./greeting";

const noopSubscribe = () => () => {};

/**
 * "Tuesday afternoon / Hey, Tanner". The time-of-day line is read from the
 * device clock on the client only; the server renders a same-height blank so
 * hydration never mismatches and nothing shifts.
 */
export function HomeGreeting({ displayName }: { displayName: string | null }) {
  const line = useSyncExternalStore(
    noopSubscribe,
    () => timeOfDayLine(new Date()),
    () => null
  );
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="min-h-[1.4em] text-[15px] font-medium text-themed-muted">{line ?? " "}</span>
      <h1 className="m-0 truncate font-[family-name:var(--font-display)] text-[30px] font-semibold leading-[1.1] text-themed-text">
        {greetingFor(displayName)}
      </h1>
    </div>
  );
}
