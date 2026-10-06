"use client";

import { useEffect, useState } from "react";
import { ALLOWED_TRIGGER_EVENTS } from "@/lib/services/survey-triggers";
import {
  GATING_TIMEPOINTS,
  MAX_EXPIRES_DAYS,
  MAX_OFFSET_DAYS,
  ScheduleValidationError,
  parseScheduleInput,
  summarizeSchedule,
  type ScheduleInput,
} from "@/app/api/v1/surveys/[id]/schedule/schedule-config";

interface ScheduleState {
  schedule: ScheduleInput | null;
  summary: string | null;
  unmanaged_rows: number;
  survey_status: string;
  delivering: boolean;
  deliveries: number;
  responses: number;
}

/** Form fields are strings so a half-typed number is never coerced to 0. */
interface FormState {
  triggerType: "time" | "event";
  timepoint: string;
  offsetDays: string;
  expiresDays: string;
  event: string;
  useFallback: boolean;
  fallbackDays: string;
  active: boolean;
}

const EVENT_LABELS: Record<string, string> = {
  privacy_view: "First time the participant opens their privacy settings",
};

const BLANK_FORM: FormState = {
  triggerType: "time",
  timepoint: "",
  offsetDays: "0",
  expiresDays: "7",
  event: ALLOWED_TRIGGER_EVENTS[0],
  useFallback: true,
  fallbackDays: "3",
  active: true,
};

function formFrom(schedule: ScheduleInput | null): FormState {
  if (!schedule) return BLANK_FORM;
  const base = {
    ...BLANK_FORM,
    timepoint: schedule.trigger_config.timepoint,
    expiresDays: String(schedule.trigger_config.expires_days),
    active: schedule.active,
  };
  if (schedule.trigger_type === "time") {
    return { ...base, triggerType: "time", offsetDays: String(schedule.trigger_config.offset_days) };
  }
  const { event, fallback } = schedule.trigger_config;
  return {
    ...base,
    triggerType: "event",
    event,
    useFallback: fallback !== null,
    fallbackDays: fallback ? String(fallback.offset_days) : BLANK_FORM.fallbackDays,
  };
}

/** "" and "1.5x" become NaN so the shared validator reports them, instead of silently reading as 0. */
const toNumber = (text: string): number => (text.trim() === "" ? Number.NaN : Number(text));

function toBody(form: FormState) {
  const timepoint = form.timepoint.trim();
  const expires_days = toNumber(form.expiresDays);
  if (form.triggerType === "time") {
    return {
      trigger_type: "time",
      active: form.active,
      trigger_config: { timepoint, offset_days: toNumber(form.offsetDays), expires_days },
    };
  }
  return {
    trigger_type: "event",
    active: form.active,
    trigger_config: {
      timepoint,
      event: form.event,
      expires_days,
      fallback: form.useFallback ? { offset_days: toNumber(form.fallbackDays) } : null,
    },
  };
}

/** Validate the form with the same rules the endpoint applies. */
function validate(form: FormState): { schedule: ScheduleInput | null; problem: string | null } {
  try {
    return { schedule: parseScheduleInput(toBody(form)), problem: null };
  } catch (error) {
    if (error instanceof ScheduleValidationError) return { schedule: null, problem: friendly(error.message) };
    throw error;
  }
}

/** The endpoint's messages name JSON fields; the form names its own labels. */
function friendly(message: string): string {
  return message
    .replace("fallback.offset_days", "The fallback day")
    .replace("offset_days", "Days after enrollment")
    .replace("expires_days", "Days open")
    .replace("timepoint is required", "A timepoint is required");
}

const INPUT =
  "mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";

interface Props {
  surveyId: string;
}

export default function SurveyScheduleSection({ surveyId }: Props) {
  const [state, setState] = useState<ScheduleState | null>(null);
  const [form, setForm] = useState<FormState>(BLANK_FORM);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    fetch(`/api/v1/surveys/${surveyId}/schedule`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        return body as ScheduleState;
      })
      .then((loaded) => {
        setState(loaded);
        setForm(formFrom(loaded.schedule));
      })
      .catch((err: Error) => setLoadError(`Could not load the delivery schedule: ${err.message}`));
  }, [surveyId]);

  function patch(change: Partial<FormState>) {
    setForm((prev) => ({ ...prev, ...change }));
    setDirty(true);
    setMessage(null);
  }

  /**
   * Send a write; when the server answers `confirmation_required`, show its
   * reasons and repeat with confirmation only if the admin agrees.
   */
  async function send(method: "PUT" | "DELETE", body?: Record<string, unknown>): Promise<ScheduleState | null> {
    const call = (confirm: boolean) =>
      fetch(`/api/v1/surveys/${surveyId}/schedule${method === "DELETE" && confirm ? "?confirm=true" : ""}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(confirm ? { ...body, confirm: true } : body) : undefined,
      });

    let res = await call(false);
    let payload = await res.json().catch(() => ({}));
    if (res.status === 409 && payload.code === "confirmation_required") {
      const reasons: string[] = Array.isArray(payload.warnings) ? payload.warnings : [];
      const verb = method === "DELETE" ? "Remove the schedule anyway?" : "Save the schedule anyway?";
      if (!window.confirm(`${reasons.join("\n\n")}\n\n${verb}`)) return null;
      res = await call(true);
      payload = await res.json().catch(() => ({}));
    }
    if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
    return payload as ScheduleState;
  }

  async function save() {
    const { problem } = validate(form);
    if (problem) {
      setMessage({ kind: "err", text: problem });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await send("PUT", toBody(form));
      if (saved) {
        setState(saved);
        setForm(formFrom(saved.schedule));
        setDirty(false);
        setMessage({ kind: "ok", text: "Schedule saved." });
      }
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Remove this delivery schedule? The survey will not be sent to anyone until a new one is saved.")) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const saved = await send("DELETE");
      if (saved) {
        setState(saved);
        setForm(BLANK_FORM);
        setDirty(false);
        setMessage({ kind: "ok", text: "Schedule removed." });
      }
    } catch (err) {
      setMessage({ kind: "err", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <section className="mb-6 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        {loadError}
      </section>
    );
  }
  if (!state) {
    return <section className="mb-6 h-32 animate-pulse rounded-lg bg-gray-100" aria-label="Loading delivery schedule" />;
  }

  const { schedule: draft, problem } = validate(form);
  const saved = state.schedule;
  const gates = GATING_TIMEPOINTS.includes(form.timepoint.trim());
  const hasData = state.deliveries > 0 || state.responses > 0;

  return (
    <section aria-labelledby="schedule-heading" className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 id="schedule-heading" className="text-sm font-semibold text-gray-900">
          Delivery schedule
        </h2>
        <StatusPill state={state} />
      </div>
      <p className="mb-3 text-xs text-gray-500">
        {saved
          ? `${state.summary}. Timepoint ${saved.trigger_config.timepoint || "(none)"}.`
          : "No schedule yet. A survey is only sent to participants once it has a schedule and is active."}
      </p>

      {hasData && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {state.deliveries} deliver{state.deliveries === 1 ? "y" : "ies"} and {state.responses} response
          {state.responses === 1 ? "" : "s"} already exist. Participants who already received this survey keep their
          delivery; a changed schedule only applies to those not yet sent it.
        </div>
      )}
      {state.unmanaged_rows > 0 && (
        <div role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          This survey has {state.unmanaged_rows} schedule row{state.unmanaged_rows === 1 ? "" : "s"} of a kind that is
          never delivered or that duplicates another. Saving here replaces {state.unmanaged_rows === 1 ? "it" : "them"}.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-gray-500">
          Send
          <select
            value={form.triggerType}
            onChange={(e) => patch({ triggerType: e.target.value as FormState["triggerType"] })}
            className={INPUT}
          >
            <option value="time">A set number of days after enrollment</option>
            <option value="event">When something happens in the app</option>
          </select>
        </label>
        <label className="text-xs text-gray-500">
          Timepoint label
          <input
            value={form.timepoint}
            onChange={(e) => patch({ timepoint: e.target.value })}
            placeholder="e.g. T2"
            maxLength={16}
            className={INPUT}
          />
        </label>
        <label className="text-xs text-gray-500">
          Days open before it closes
          <input
            type="number"
            min={1}
            max={MAX_EXPIRES_DAYS}
            value={form.expiresDays}
            onChange={(e) => patch({ expiresDays: e.target.value })}
            className={INPUT}
          />
        </label>
      </div>

      {form.triggerType === "time" ? (
        <label className="mt-3 block text-xs text-gray-500 sm:w-1/3">
          Days after enrollment (0 = at enrollment)
          <input
            type="number"
            min={0}
            max={MAX_OFFSET_DAYS}
            value={form.offsetDays}
            onChange={(e) => patch({ offsetDays: e.target.value })}
            className={INPUT}
          />
        </label>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-gray-500 sm:col-span-2">
            Event
            <select value={form.event} onChange={(e) => patch({ event: e.target.value })} className={INPUT}>
              {ALLOWED_TRIGGER_EVENTS.map((ev) => (
                <option key={ev} value={ev}>
                  {EVENT_LABELS[ev] ?? ev}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-500">
            <label className="flex items-center gap-1.5 text-gray-600">
              <input
                type="checkbox"
                checked={form.useFallback}
                onChange={(e) => patch({ useFallback: e.target.checked })}
              />
              Otherwise send after (days)
            </label>
            <input
              type="number"
              min={0}
              max={MAX_OFFSET_DAYS}
              value={form.fallbackDays}
              disabled={!form.useFallback}
              onChange={(e) => patch({ fallbackDays: e.target.value })}
              aria-label="Fallback: days after enrollment"
              className={`${INPUT} disabled:bg-gray-50 disabled:text-gray-400`}
            />
          </div>
        </div>
      )}

      <label className="mt-3 flex items-center gap-1.5 text-xs text-gray-600">
        <input type="checkbox" checked={form.active} onChange={(e) => patch({ active: e.target.checked })} />
        Schedule switched on
      </label>

      <p className={`mt-3 text-xs ${problem ? "text-red-600" : "text-gray-600"}`} aria-live="polite">
        {problem ?? (draft ? `${dirty ? "Will read: " : ""}${summarizeSchedule(draft)}.` : "")}
      </p>
      {!problem && gates && (
        <p className="mt-1 text-xs text-amber-700">
          Timepoint {form.timepoint.trim()} is a gating check-in: while it is waiting, the participant cannot save
          privacy settings until they answer it.
        </p>
      )}
      {!problem && form.triggerType === "event" && !form.useFallback && (
        <p className="mt-1 text-xs text-amber-700">
          Without a fallback, participants who never open their privacy settings are never sent this survey.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={busy || Boolean(problem) || (!dirty && saved !== null)}
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {busy ? "Working..." : saved ? "Save schedule" : "Add schedule"}
        </button>
        {saved && (
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Remove schedule
          </button>
        )}
        {message && (
          <span role="status" className={`text-sm ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
            {message.text}
          </span>
        )}
        {dirty && !message && <span className="text-sm text-amber-600">Unsaved schedule changes</span>}
      </div>
    </section>
  );
}

function StatusPill({ state }: { state: ScheduleState }) {
  const [label, style] = !state.schedule
    ? ["Not scheduled", "border-red-200 bg-red-50 text-red-600"]
    : !state.schedule.active
      ? ["Schedule off", "border-amber-200 bg-amber-50 text-amber-700"]
      : state.delivering
        ? ["Delivering", "border-green-200 bg-green-50 text-green-700"]
        : [`Scheduled · survey is ${state.survey_status}`, "border-gray-200 bg-gray-50 text-gray-600"];
  return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}>{label}</span>;
}
