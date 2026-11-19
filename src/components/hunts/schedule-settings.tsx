"use client";

import { useState } from "react";
import { CalendarClock, Lock } from "lucide-react";
import { formatInZone, readHuntWindow, readScheduleTimeZone, type WallTime } from "@/lib/hunts/schedule";
import {
  applyReleaseRule,
  parseTimes,
  scheduleFormFor,
  schedulePreview,
  scheduleRequest,
  timeZoneOptions,
  type ScheduleForm,
  type ScheduleRequestBody,
} from "@/lib/hunts/schedule-form";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const INPUT = "rounded-md border border-gray-300 px-2 py-1.5 text-sm";

export interface ScheduleStop {
  id: string;
  label: string;
  release_at?: string | null;
}

interface ScheduleSettingsProps {
  hunt: { starts_at?: string | null; ends_at?: string | null; metadata: Record<string, unknown> | null };
  stops: ReadonlyArray<ScheduleStop>;
  /** Published or played: shown read-only (the API rejects changes too). */
  locked: boolean;
  busy: boolean;
  /** Saves the schedule (or clears it with null). Resolves true when it was saved. */
  onSave: (body: ScheduleRequestBody | null) => Promise<boolean>;
  /** The clock and device zone, passed in so the form's starting point can be tested. */
  nowMs?: number;
  deviceTimeZone?: string | null;
}

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Hunt settings section for a multi-day schedule (issue #14): the window
 * everyone shares, and when each stop is released. A rule fills the release
 * times in ("1 stop at 9:00 and 15:00, Monday to Friday"); each one can then
 * be changed by hand. Nothing is saved until "Save schedule". Re-mount it
 * (via `key`) when the saved schedule or the stops change.
 */
export function ScheduleSettings({ hunt, stops, locked, busy, onSave, nowMs, deviceTimeZone }: ScheduleSettingsProps) {
  const scheduled = readHuntWindow(hunt) !== null;
  const zone = deviceTimeZone === undefined ? deviceZone() : deviceTimeZone;
  const [enabled, setEnabled] = useState(scheduled);
  const [form, setForm] = useState<ScheduleForm>(() => scheduleFormFor(hunt, stops, { nowMs: nowMs ?? Date.now(), deviceTimeZone: zone }));
  const [perRelease, setPerRelease] = useState("1");
  const [timesText, setTimesText] = useState("09:00, 15:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [ruleError, setRuleError] = useState("");

  if (locked) return <LockedView hunt={hunt} stops={stops} />;

  if (!enabled) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-700">
          This hunt can be played any time. A scheduled hunt starts and ends on set dates for everyone and releases its
          stops a few at a time.
        </p>
        <button
          type="button"
          disabled={busy || stops.length === 0}
          onClick={() => setEnabled(true)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          Set a schedule
        </button>
        {stops.length === 0 && <p className="text-[11px] text-gray-500">Add the hunt&apos;s stops first.</p>}
      </div>
    );
  }

  const request = scheduleRequest(form);
  const preview = schedulePreview(form);
  const setWall = (key: "start" | "end", part: keyof WallTime, value: string) =>
    setForm((f) => ({ ...f, [key]: { ...f[key], [part]: value } }));
  const setStopWall = (findId: string, wall: WallTime | null) =>
    setForm((f) => ({ ...f, stops: f.stops.map((s) => (s.findId === findId ? { ...s, wall } : s)) }));

  const fillIn = () => {
    const times = parseTimes(timesText);
    if (!times) return setRuleError("Write the release times like 09:00, 15:00.");
    const result = applyReleaseRule(form, {
      firstDate: form.start.date,
      weekdays,
      times,
      perRelease: /^\d+$/.test(perRelease.trim()) ? Number(perRelease) : Number.NaN,
    });
    if (!result.ok) return setRuleError(result.error);
    setRuleError("");
    setForm(result.form);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <WallTimeField label="Hunt starts" idPrefix="schedule-start" value={form.start} disabled={busy} onChange={(part, v) => setWall("start", part, v)} />
        <WallTimeField label="Hunt ends" idPrefix="schedule-end" value={form.end} disabled={busy} onChange={(part, v) => setWall("end", part, v)} />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="schedule-timezone">Time zone</label>
        <select
          id="schedule-timezone"
          value={form.timeZone}
          disabled={busy}
          onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))}
          className={`${INPUT} w-full sm:w-auto`}
        >
          {timeZoneOptions(form.timeZone, zone).map((tz) => (
            <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-gray-500">
          Times below are in this zone. A release is the same moment for every player, wherever they are.
        </p>
      </div>

      <fieldset className="rounded-md border border-gray-200 p-3" disabled={busy}>
        <legend className="px-1 text-sm font-medium text-gray-700">Fill in release times</legend>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-gray-600">
            Stops per release
            <input type="text" inputMode="numeric" value={perRelease} onChange={(e) => setPerRelease(e.target.value)} className={`${INPUT} mt-1 block w-20 tabular-nums`} />
          </label>
          <label className="text-xs text-gray-600">
            At these times
            <input type="text" value={timesText} onChange={(e) => setTimesText(e.target.value)} className={`${INPUT} mt-1 block w-40 tabular-nums`} />
          </label>
          <div className="text-xs text-gray-600">
            On these days
            <div className="mt-1 flex flex-wrap gap-1">
              {WEEKDAYS.map((name, day) => (
                <label key={name} className={`cursor-pointer rounded-md border px-2 py-1.5 text-sm ${weekdays.includes(day) ? "border-sky-400 bg-sky-50 text-gray-900" : "border-gray-200 text-gray-600"}`}>
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={weekdays.includes(day)}
                    onChange={() => setWeekdays((w) => (w.includes(day) ? w.filter((d) => d !== day) : [...w, day].sort()))}
                  />
                  {name}
                </label>
              ))}
            </div>
          </div>
          <button type="button" onClick={fillIn} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50">
            Fill in
          </button>
        </div>
        <p className="mt-2 text-xs text-gray-500">Starts on the hunt&apos;s first day and works through the stops in order. You can change any time below.</p>
        {ruleError && <p className="mt-1 text-xs text-red-600" role="alert">{ruleError}</p>}
      </fieldset>

      <div>
        <p className="text-sm font-medium text-gray-700 mb-1">When each stop is released</p>
        <ul className="space-y-1.5">
          {stops.map((stop, index) => {
            const wall = form.stops.find((s) => s.findId === stop.id)?.wall ?? null;
            return (
              <li key={stop.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate text-gray-800">{stop.label}</span>
                {wall ? (
                  <>
                    <input type="date" aria-label={`Stop ${index + 1} release date`} value={wall.date} disabled={busy} onChange={(e) => setStopWall(stop.id, { ...wall, date: e.target.value })} className={INPUT} />
                    <input type="time" aria-label={`Stop ${index + 1} release time`} value={wall.time} disabled={busy} onChange={(e) => setStopWall(stop.id, { ...wall, time: e.target.value })} className={INPUT} />
                    <button type="button" disabled={busy} onClick={() => setStopWall(stop.id, null)} className="text-xs text-sky-700 hover:underline">
                      At the start
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-gray-600">When the hunt starts</span>
                    <button type="button" disabled={busy} onClick={() => setStopWall(stop.id, { ...form.start })} className="text-xs text-sky-700 hover:underline">
                      Set a time
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {preview.length > 0 && (
        <div className="rounded-md bg-gray-50 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
            <CalendarClock className="h-4 w-4 text-gray-500" aria-hidden="true" />
            Release calendar
          </p>
          <ol className="mt-1.5 space-y-0.5 text-sm text-gray-700">
            {preview.map((release) => (
              <li key={release.when} className="flex justify-between gap-3 tabular-nums">
                <span>{release.when}</span>
                <span className="text-gray-600">
                  {release.stopNumbers.length === 1 ? "Stop" : "Stops"} {release.stopNumbers.join(", ")}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {!request.ok && <p className="text-xs text-red-600" role="alert">{request.error}</p>}
      <p className="text-xs text-gray-500">
        On a scheduled hunt every released clue is open at once, and players choose which to do. Saving sets clue
        delivery to &ldquo;All at once&rdquo;.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !request.ok}
          onClick={() => request.ok && onSave(request.body)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Save schedule
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => (scheduled ? onSave(null) : setEnabled(false))}
          className="text-sm text-gray-600 hover:underline disabled:opacity-50"
        >
          {scheduled ? "Remove the schedule" : "Cancel"}
        </button>
        <span className="text-[11px] text-gray-500">Locks when the hunt is published or first played.</span>
      </div>
    </div>
  );
}

interface WallTimeFieldProps {
  label: string;
  idPrefix: string;
  value: WallTime;
  disabled: boolean;
  onChange: (part: keyof WallTime, value: string) => void;
}

function WallTimeField({ label, idPrefix, value, disabled, onChange }: WallTimeFieldProps) {
  return (
    <fieldset disabled={disabled}>
      <legend className="text-sm font-medium text-gray-700 mb-1">{label}</legend>
      <div className="flex gap-2">
        <input id={`${idPrefix}-date`} type="date" aria-label={`${label}: date`} value={value.date} onChange={(e) => onChange("date", e.target.value)} className={INPUT} />
        <input id={`${idPrefix}-time`} type="time" aria-label={`${label}: time`} value={value.time} onChange={(e) => onChange("time", e.target.value)} className={INPUT} />
      </div>
    </fieldset>
  );
}

function LockedView({ hunt, stops }: Pick<ScheduleSettingsProps, "hunt" | "stops">) {
  const window = readHuntWindow(hunt);
  if (!window) {
    return (
      <p className="flex items-start gap-1.5 text-sm text-gray-800">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden="true" />
        <span>
          <span className="font-medium">Play any time.</span>{" "}
          <span className="text-gray-500">A schedule can be set while the hunt is a draft nobody has played.</span>
        </span>
      </p>
    );
  }
  const timeZone = readScheduleTimeZone(hunt.metadata);
  const preview = schedulePreview(scheduleFormFor(hunt, stops, { nowMs: 0 }));
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-sm text-gray-800">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden="true" />
        <span>
          <span className="font-medium">
            {formatInZone(window.startsAtMs, timeZone)} to {formatInZone(window.endsAtMs, timeZone)}
          </span>
          <span className="text-gray-500"> · {timeZone.replace(/_/g, " ")}</span>
        </span>
      </p>
      <ol className="space-y-0.5 text-sm text-gray-700">
        {preview.map((release) => (
          <li key={release.when} className="flex justify-between gap-3 tabular-nums">
            <span>{release.when}</span>
            <span className="text-gray-600">
              {release.stopNumbers.length === 1 ? "Stop" : "Stops"} {release.stopNumbers.join(", ")}
            </span>
          </li>
        ))}
      </ol>
      <p className="text-[11px] text-gray-500">
        Locked because this hunt has been published or played. Unpublish it (if nobody has played it) or clone it to
        change the schedule.
      </p>
    </div>
  );
}
