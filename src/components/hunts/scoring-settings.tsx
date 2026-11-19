"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  DEFAULT_SOLVE_WINDOW_MINUTES,
  SCORING_VERSION_DESCRIPTIONS,
  SCORING_VERSION_LABELS,
  SOLVE_WINDOW_INVALID_MESSAGE,
  isValidSolveWindowInput,
  readScoringVersion,
  readSolveWindowMinutes,
  scoringSettingsChanged,
  withScoringSettings,
  type ScoringVersion,
} from "@/lib/hunts/scoring-version";
import { cn } from "@/lib/utils/cn";

const VERSIONS: ReadonlyArray<ScoringVersion> = [2, 1];

interface ScoringSettingsProps {
  metadata: Record<string, unknown> | null;
  /** The hunt is a draft: scoring is edited on drafts only, like the other settings. */
  draft: boolean;
  /** Someone has played the hunt: the API refuses a change from here on. */
  played: boolean;
  busy: boolean;
  onSave: (metadata: Record<string, unknown>, successText: string) => Promise<boolean>;
}

/**
 * "" means "use the default"; anything else must be a whole number. The field
 * is a text input on purpose: a number input reports "" for text it can't
 * parse ("9e"), which would read as "use the default" and clear a stored window.
 */
function parseWindow(text: string): number | null | "invalid" {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return "invalid";
  return Number(trimmed);
}

/**
 * Hunt settings section for scoring (issue #11): which version scores the
 * hunt and, on the timed version, how long speed points last. Nothing is
 * saved until "Save". Read-only once the hunt is published or played.
 * Re-mount it (via `key`) when the saved setting changes.
 */
export function ScoringSettings({ metadata, draft, played, busy, onSave }: ScoringSettingsProps) {
  const savedVersion = readScoringVersion(metadata);
  const savedWindow = readSolveWindowMinutes(metadata);
  const [version, setVersion] = useState<ScoringVersion>(savedVersion);
  const [windowText, setWindowText] = useState(savedWindow === null ? "" : String(savedWindow));

  if (played || !draft) return <LockedView version={savedVersion} solveWindow={savedWindow} played={played} />;

  const parsed = parseWindow(windowText);
  const windowOk = version === 1 || (parsed !== "invalid" && isValidSolveWindowInput(parsed));
  const next = withScoringSettings(metadata, version, parsed === "invalid" ? null : parsed);
  const dirty = scoringSettingsChanged(metadata, next);

  return (
    <div className="space-y-3">
      <fieldset className="space-y-1.5" disabled={busy}>
        <legend className="text-sm font-medium text-gray-700 mb-1">How stops are scored</legend>
        {VERSIONS.map((v) => {
          const id = `scoring-version-${v}`;
          const checked = version === v;
          return (
            <label
              key={v}
              htmlFor={id}
              className={cn(
                "flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors",
                checked ? "border-sky-400 bg-sky-50" : "border-gray-200 hover:bg-gray-50",
                busy && "cursor-not-allowed opacity-70"
              )}
            >
              <input
                id={id}
                type="radio"
                name="scoring-version"
                value={v}
                checked={checked}
                onChange={() => setVersion(v)}
                className="mt-0.5 accent-sky-600"
              />
              <span>
                <span className="block text-sm text-gray-800">{SCORING_VERSION_LABELS[v]}</span>
                <span className="block text-xs text-gray-500">{SCORING_VERSION_DESCRIPTIONS[v]}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {version === 2 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="scoring-solve-window">
            Speed points run out after
          </label>
          <div className="flex items-center gap-2">
            <input
              id="scoring-solve-window"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={windowText}
              placeholder={String(DEFAULT_SOLVE_WINDOW_MINUTES)}
              disabled={busy}
              aria-describedby="scoring-solve-window-help"
              aria-invalid={!windowOk}
              onChange={(e) => setWindowText(e.target.value)}
              className="w-24 rounded-md border border-gray-300 px-3 py-1.5 text-sm tabular-nums"
            />
            <span className="text-sm text-gray-700">minutes</span>
          </div>
          <p id="scoring-solve-window-help" className="mt-1 text-xs text-gray-500">
            Leave empty for {DEFAULT_SOLVE_WINDOW_MINUTES} minutes. The walk to the stop counts, so give hunts with
            stops far apart a longer window.
          </p>
          {!windowOk && <p className="mt-1 text-xs text-red-600" role="alert">{SOLVE_WINDOW_INVALID_MESSAGE}</p>}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty || !windowOk}
          onClick={() => onSave(next, `Scoring set to "${SCORING_VERSION_LABELS[version]}".`)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Save scoring
        </button>
        <span className="text-[11px] text-gray-500">Locks when the hunt is first played.</span>
      </div>
    </div>
  );
}

interface LockedViewProps {
  version: ScoringVersion;
  solveWindow: number | null;
  played: boolean;
}

function LockedView({ version, solveWindow, played }: LockedViewProps) {
  return (
    <div className="space-y-2">
      <p className="flex items-start gap-1.5 text-sm text-gray-800">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden="true" />
        <span>
          <span className="font-medium">{SCORING_VERSION_LABELS[version]}</span>
          <span className="text-gray-500"> · {SCORING_VERSION_DESCRIPTIONS[version]}</span>
        </span>
      </p>
      {version === 2 && (
        <p className="text-xs text-gray-600">
          Speed points run out after {solveWindow ?? DEFAULT_SOLVE_WINDOW_MINUTES} minutes.
        </p>
      )}
      <p className="text-[11px] text-gray-500">
        {played
          ? "Locked because this hunt has been played. Clone the hunt to use different scoring."
          : "Scoring can be changed while the hunt is a draft."}
      </p>
    </div>
  );
}
