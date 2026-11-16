"use client";

import { ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react";
import { MAX_CLUE_ORDERS } from "@/lib/play/clue-delivery";
import { addOrder, moveStop, removeOrder } from "@/lib/hunts/clue-order-edits";

export interface StopLabel {
  id: string;
  label: string;
}

interface ClueOrdersEditorProps {
  stops: ReadonlyArray<StopLabel>;
  orders: ReadonlyArray<ReadonlyArray<string>>;
  onChange: (orders: string[][]) => void;
  /** Read-only view (locked hunt). */
  readOnly?: boolean;
  disabled?: boolean;
}

const iconButton =
  "inline-flex h-7 w-7 items-center justify-center rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * Defines the n orders for "Assigned orders": each order lists every stop, and
 * each player is assigned one of them. Orders always hold every stop (they are
 * fitted to the current stops before they reach here), so editing is limited
 * to reordering, adding and removing whole orders.
 */
export function ClueOrdersEditor({ stops, orders, onChange, readOnly = false, disabled = false }: ClueOrdersEditorProps) {
  const labels = new Map(stops.map((s) => [s.id, s.label]));
  const findIds = stops.map((s) => s.id);
  const locked = readOnly || disabled;

  if (stops.length === 0) {
    return <p className="text-xs text-gray-500">Add stops first, then define the orders players are assigned.</p>;
  }

  return (
    <div className="space-y-3">
      {orders.map((order, index) => (
        <div key={index} className="rounded-md border border-gray-200 p-2">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-gray-700">Order {index + 1}</span>
            {!readOnly && (
              <button
                type="button"
                className={iconButton}
                disabled={disabled}
                onClick={() => onChange(removeOrder(orders, index))}
                aria-label={`Remove order ${index + 1}`}
                title="Remove this order"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
          <ol className="space-y-1">
            {order.map((id, position) => (
              <li key={id} className="flex items-center gap-2 text-sm text-gray-800">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-gray-400">{position + 1}.</span>
                <span className="min-w-0 flex-1 truncate">{labels.get(id) ?? "Removed stop"}</span>
                {!readOnly && (
                  <span className="flex gap-1">
                    <button
                      type="button"
                      className={iconButton}
                      disabled={locked || position === 0}
                      onClick={() => onChange(moveStop(orders, index, position, -1))}
                      aria-label={`Move ${labels.get(id) ?? "stop"} earlier in order ${index + 1}`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={iconButton}
                      disabled={locked || position === order.length - 1}
                      onClick={() => onChange(moveStop(orders, index, position, 1))}
                      aria-label={`Move ${labels.get(id) ?? "stop"} later in order ${index + 1}`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      ))}

      {!readOnly && (
        <button
          type="button"
          disabled={disabled || orders.length >= MAX_CLUE_ORDERS}
          onClick={() => onChange(addOrder(orders, findIds))}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Add an order
        </button>
      )}
    </div>
  );
}
