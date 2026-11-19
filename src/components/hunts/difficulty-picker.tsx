"use client";

import {
  NAVIGATION_HELP_DESCRIPTIONS,
  NAVIGATION_HELP_LABELS,
  NAVIGATION_HELP_LEVELS,
  type NavigationHelp,
} from "@/lib/play/navigation-help";
import { cn } from "@/lib/utils/cn";

interface DifficultyPickerProps {
  /** Radio group name; unique per form. */
  name: string;
  value: NavigationHelp;
  onChange: (level: NavigationHelp) => void;
  disabled?: boolean;
}

/**
 * The three difficulty levels: how much help players get finding each stop
 * (lib/play/navigation-help.ts). A radio group shared by the new-hunt form and
 * the hunt settings.
 */
export function DifficultyPicker({ name, value, onChange, disabled = false }: DifficultyPickerProps) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-sm font-medium text-gray-700 mb-1">Difficulty: how much help players get finding each stop</legend>
      {NAVIGATION_HELP_LEVELS.map((level) => {
        const id = `${name}-${level}`;
        const checked = value === level;
        return (
          <label
            key={level}
            htmlFor={id}
            className={cn(
              "flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer transition-colors",
              checked ? "border-sky-400 bg-sky-50" : "border-gray-200 hover:bg-gray-50",
              disabled && "cursor-not-allowed opacity-70"
            )}
          >
            <input
              id={id}
              type="radio"
              name={name}
              value={level}
              checked={checked}
              onChange={() => onChange(level)}
              className="mt-0.5 accent-sky-600"
            />
            <span>
              <span className="block text-sm text-gray-800">{NAVIGATION_HELP_LABELS[level]}</span>
              <span className="block text-xs text-gray-500">{NAVIGATION_HELP_DESCRIPTIONS[level]}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
