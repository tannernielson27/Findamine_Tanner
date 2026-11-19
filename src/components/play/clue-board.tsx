"use client";

import { CalendarClock, CheckCircle2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import type { Find, PlaySchedule } from "@/lib/play/play-types";
import { formatCountdown, formatInZone } from "@/lib/hunts/schedule";
import { cn } from "@/lib/utils/cn";

interface ClueBoardProps {
  finds: ReadonlyArray<Find>;
  completedFinds: ReadonlySet<string>;
  /** The clue the player is working on now, if any. */
  activeId: string | null;
  onPick: (findId: string) => void;
  /** Close and keep the active clue; null when there is no open clue to go back to. */
  onClose: (() => void) | null;
  /** Scheduled hunts (issue #14): the hunt's window. Null on a play-anytime hunt. */
  schedule?: PlaySchedule | null;
  /**
   * The server's time now, in ms: what countdowns are measured against. Left
   * out, a stop still to come shows when it opens without a countdown.
   */
  nowMs?: number;
  /** Zone to show times in; the device's own when left out. */
  timeZone?: string;
  /** Scheduled hunts, once ended: wraps up the session and shows the summary. */
  onFinish?: (() => void) | null;
  finishing?: boolean;
}

/**
 * "All clues at once" hunts: every unfinished stop, and the player picks the
 * one to work on. A stop shows its clue only once the player has started it
 * ("I'm ready"); until then it is listed by number, because its clue is not on
 * the device yet. The map, hot/cold and arrival all follow the active stop;
 * the player can come back here and switch at any time.
 *
 * On a scheduled hunt this is also the hunt's home between visits: what is
 * open now, what is still to come and when, and when the hunt ends. A stop
 * that has not been released is listed with the time it opens and no button:
 * nothing else about it is on the device.
 */
export function ClueBoard(props: ClueBoardProps) {
  const { finds, completedFinds, activeId, onPick, onClose, schedule = null, timeZone, nowMs } = props;
  const unfinished = finds.flatMap((find, index) => (completedFinds.has(find.id) ? [] : [{ find, stopNumber: index + 1 }]));
  const ready = unfinished.filter(({ find }) => !find.release_at);
  const held = unfinished.filter(({ find }) => !!find.release_at);
  const doneCount = finds.length - unfinished.length;
  const ended = schedule?.phase === "ended";
  const when = (iso: string) => formatInZone(Date.parse(iso), timeZone);

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="clue-board-heading"
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[82%] flex-col rounded-t-[28px] bg-white text-ink shadow-raised pb-[env(safe-area-inset-bottom)]"
    >
      <header className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h2 id="clue-board-heading" className="text-lg font-bold">
            {ended ? "This hunt has ended" : "Choose a stop"}
          </h2>
          <p className="text-sm text-themed-muted">
            {ready.length} open · {doneCount} of {finds.length} found
            {held.length > 0 ? ` · ${held.length} still to come` : ""}.
            {!ended && ready.length > 0 ? " Pick one to work on; you can switch any time." : ""}
          </p>
          {schedule && !ended && (
            <p className="mt-1 flex items-center gap-1.5 text-sm text-themed-muted">
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
              Hunt ends {when(schedule.ends_at)}
            </p>
          )}
        </div>
        {onClose && !ended && (
          <IconButton label="Back to the active clue" tone="floating" onClick={onClose} className="bg-white text-ink">
            <X className="h-5 w-5" aria-hidden="true" />
          </IconButton>
        )}
      </header>

      <ul className="flex flex-col gap-2.5 overflow-y-auto px-5 pb-5">
        {ended && (
          <li className="rounded-[18px] border border-themed-border bg-surface p-4">
            <p className="text-[15px] leading-snug">
              No more stops can be played. You found {doneCount} of {finds.length}.
            </p>
            {props.onFinish && (
              <Button size="md" variant="ink" className="mt-3" onClick={props.onFinish} disabled={props.finishing}>
                {props.finishing ? "Finishing..." : "See your results"}
              </Button>
            )}
          </li>
        )}
        {!ended &&
          ready.map(({ find, stopNumber }) => {
            const active = find.id === activeId;
            const started = !!find.started_at;
            const pickLabel = started ? "Work on this clue" : `Open stop ${stopNumber}`;
            return (
              <li
                key={find.id}
                className={cn(
                  "rounded-[18px] border p-4",
                  active ? "border-brand bg-sky-tint" : "border-themed-border bg-surface"
                )}
              >
                <p className="text-sm font-bold uppercase tracking-[0.04em] text-juniper-deep">Stop {stopNumber}</p>
                <p className="text-[15px] leading-snug">
                  {started
                    ? find.clue_text || "No written clue: follow the map."
                    : "Not started yet. Its clue appears when you tap I'm ready."}
                </p>
                <Button
                  size="md"
                  variant={active ? "ink" : "secondary"}
                  className="mt-3"
                  onClick={() => onPick(find.id)}
                  aria-label={active ? `Keep working on stop ${stopNumber}` : pickLabel}
                >
                  {active ? "Keep working on this" : pickLabel}
                </Button>
              </li>
            );
          })}
        {!ended &&
          held.map(({ find, stopNumber }) => (
            <li key={find.id} className="flex items-start gap-3 rounded-[18px] border border-dashed border-themed-border p-4 text-themed-muted">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.04em]">Stop {stopNumber}</p>
                <p className="text-[15px] leading-snug">
                  Opens {when(find.release_at as string)}
                  {nowMs !== undefined && (
                    <span className="tabular-nums"> · in {formatCountdown(Date.parse(find.release_at as string) - nowMs)}</span>
                  )}
                </p>
              </div>
            </li>
          ))}
        {!ended && ready.length === 0 && held.length > 0 && (
          <li className="text-sm text-themed-muted">You&apos;re caught up. Come back when the next stop opens.</li>
        )}
        {unfinished.length === 0 && (
          <li className="flex items-center gap-2 text-sm text-themed-muted">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Every clue is found.
          </li>
        )}
      </ul>
    </section>
  );
}
