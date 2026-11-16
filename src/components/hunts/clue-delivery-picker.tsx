"use client";

import {
  CLUE_DELIVERY_DESCRIPTIONS,
  CLUE_DELIVERY_LABELS,
  CLUE_DELIVERY_MODES,
  type ClueDelivery,
} from "@/lib/play/clue-delivery";
import { cn } from "@/lib/utils/cn";

interface ClueDeliveryPickerProps {
  /** Radio group name; unique per form. */
  name: string;
  value: ClueDelivery;
  onChange: (mode: ClueDelivery) => void;
  disabled?: boolean;
}

/**
 * The four ways a hunt can hand out clues (lib/play/clue-delivery.ts), as a
 * radio group. Shared by the new-hunt form and the hunt settings.
 */
export function ClueDeliveryPicker({ name, value, onChange, disabled = false }: ClueDeliveryPickerProps) {
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-sm font-medium text-gray-700 mb-1">How clues are given</legend>
      {CLUE_DELIVERY_MODES.map((mode) => {
        const id = `${name}-${mode}`;
        const checked = value === mode;
        return (
          <label
            key={mode}
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
              value={mode}
              checked={checked}
              onChange={() => onChange(mode)}
              className="mt-0.5 accent-sky-600"
            />
            <span>
              <span className="block text-sm text-gray-800">{CLUE_DELIVERY_LABELS[mode]}</span>
              <span className="block text-xs text-gray-500">{CLUE_DELIVERY_DESCRIPTIONS[mode]}</span>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
