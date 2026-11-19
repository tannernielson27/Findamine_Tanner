"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  NAVIGATION_HELP_DESCRIPTIONS,
  NAVIGATION_HELP_LABELS,
  readNavigationHelp,
  withNavigationHelp,
  type NavigationHelp,
} from "@/lib/play/navigation-help";
import { DifficultyPicker } from "@/components/hunts/difficulty-picker";

interface DifficultySettingsProps {
  metadata: Record<string, unknown> | null;
  /** Published or played: shown read-only (the API rejects changes too). */
  locked: boolean;
  /** Someone has played the hunt, so unpublishing won't unlock it. */
  played: boolean;
  busy: boolean;
  onSave: (metadata: Record<string, unknown>, successText: string) => Promise<boolean>;
}

/**
 * Hunt settings section for difficulty (navigation help). The creator picks a
 * level; nothing is saved until "Save". Re-mount it (via `key`) when the saved
 * level changes.
 */
export function DifficultySettings({ metadata, locked, played, busy, onSave }: DifficultySettingsProps) {
  const saved = readNavigationHelp(metadata);
  const [level, setLevel] = useState<NavigationHelp>(saved);

  if (locked) {
    return (
      <div className="space-y-2">
        <p className="flex items-start gap-1.5 text-sm text-gray-800">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden="true" />
          <span>
            <span className="font-medium">{NAVIGATION_HELP_LABELS[saved]}</span>
            <span className="text-gray-500"> · {NAVIGATION_HELP_DESCRIPTIONS[saved]}</span>
          </span>
        </p>
        <p className="text-[11px] text-gray-500">
          {played
            ? "Locked because this hunt has been played. Clone the hunt to use a different difficulty."
            : "Locked while the hunt is published. Unpublish it to change the difficulty."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <DifficultyPicker name="difficulty" value={level} onChange={setLevel} disabled={busy} />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || level === saved}
          onClick={() => onSave(withNavigationHelp(metadata, level), `Difficulty set to "${NAVIGATION_HELP_LABELS[level]}".`)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Save difficulty
        </button>
        <span className="text-[11px] text-gray-500">Locks when the hunt is published or first played.</span>
      </div>
    </div>
  );
}
