import { CalendarClock } from "lucide-react";
import {
  formatCountdown,
  formatInZone,
  huntPhase,
  readHuntWindow,
  readScheduleTimeZone,
  type HuntWindow,
  type HuntWindowSource,
} from "@/lib/hunts/schedule";

interface ScheduleSummaryProps {
  window: HuntWindow;
  /** The zone the creator set the schedule in: times are shown in it, and it is named. */
  timeZone: string;
  nowMs: number;
}

/** "This hunt starts Mon, Nov 23, 9:00 AM (America/Denver time)." for the start bar. */
export function scheduleBlockNote(window: HuntWindow, timeZone: string, nowMs: number): string | null {
  const phase = huntPhase(window, nowMs);
  if (phase === "upcoming") return `This hunt starts ${formatInZone(window.startsAtMs, timeZone)} (${zoneName(timeZone)} time).`;
  if (phase === "ended") return "This hunt has ended and can no longer be played.";
  return null;
}

export interface HuntScheduleView {
  window: HuntWindow;
  timeZone: string;
  /** The server's clock when the page was put together. */
  nowMs: number;
  /** Why the hunt can't be started right now; null when it can. */
  blockNote: string | null;
}

/**
 * A scheduled hunt's dates as the hunt page shows them, or null for a
 * play-anytime hunt. Reads the clock once, here, so the page and its start
 * bar agree on where the hunt is in its run.
 */
export function huntScheduleView(hunt: HuntWindowSource & { metadata?: unknown }): HuntScheduleView | null {
  const window = readHuntWindow(hunt);
  if (!window) return null;
  const timeZone = readScheduleTimeZone((hunt.metadata as Record<string, unknown> | null) ?? null);
  const nowMs = Date.now();
  return { window, timeZone, nowMs, blockNote: scheduleBlockNote(window, timeZone, nowMs) };
}

function zoneName(timeZone: string): string {
  return timeZone.replace(/_/g, " ");
}

/**
 * A scheduled hunt's dates, for the hunt page before a player starts
 * (issue #14). Rendered on the server, so times are in the hunt's own zone
 * and say so, rather than in a zone guessed for the reader.
 */
export function ScheduleSummary({ window, timeZone, nowMs }: ScheduleSummaryProps) {
  const phase = huntPhase(window, nowMs);
  const status =
    phase === "upcoming"
      ? `Starts in ${formatCountdown(window.startsAtMs - nowMs)}.`
      : phase === "open"
      ? `Running now. Ends in ${formatCountdown(window.endsAtMs - nowMs)}.`
      : "This hunt has ended.";
  return (
    <div className="flex items-start gap-3">
      <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-themed-muted" aria-hidden="true" />
      <div className="space-y-1">
        <p className="text-base font-semibold text-themed-text tabular-nums">
          {formatInZone(window.startsAtMs, timeZone)} to {formatInZone(window.endsAtMs, timeZone)}
          <span className="font-normal text-themed-muted"> · {zoneName(timeZone)} time</span>
        </p>
        <p className="text-[15px] text-themed-text">{status}</p>
        {phase !== "ended" && (
          <p className="text-[15px] text-themed-muted">
            Stops are released a few at a time. Join any time while the hunt is running and you get every stop
            released so far.
          </p>
        )}
      </div>
    </div>
  );
}
