"use client";

import { FlaskConical } from "lucide-react";

interface StudyHuntSettingProps {
  studyHunt: boolean;
  /** Admins and researchers only; everyone else sees it read-only. */
  canSet: boolean;
  /** Published or played: a study hunt can no longer be unmarked. */
  locked: boolean;
  busy: boolean;
  onChange: (on: boolean) => void;
}

const EXPLANATION =
  "Study hunts keep the same stops for every participant: once published or played, stops can't be added, removed or reordered.";

/**
 * The "Study hunt" flag (hunt metadata `study_hunt`, lib/hunts/delivery-lock).
 * Admins and researchers get a toggle; owners see it read-only when it is on,
 * and nothing when it is off.
 */
export function StudyHuntSetting({ studyHunt, canSet, locked, busy, onChange }: StudyHuntSettingProps) {
  if (!canSet) {
    if (!studyHunt) return null;
    return (
      <div className="mb-4 flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
        <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong>Study hunt.</strong> {EXPLANATION} Only admins and researchers can change this.
        </span>
      </div>
    );
  }

  const cannotClear = studyHunt && locked;
  return (
    <div className="mb-4 rounded-md border border-gray-200 px-3 py-2">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={studyHunt}
          disabled={busy || cannotClear}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-0.5 rounded accent-violet-600"
        />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
            <FlaskConical className="h-4 w-4 text-violet-600" aria-hidden="true" />
            Study hunt
          </span>
          <span className="block text-[11px] text-gray-500">
            {EXPLANATION}
            {cannotClear && " This one has been published or played, so it stays a study hunt."}
          </span>
        </span>
      </label>
    </div>
  );
}
