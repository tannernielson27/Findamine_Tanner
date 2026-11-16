"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  CLUE_DELIVERY_DESCRIPTIONS,
  CLUE_DELIVERY_LABELS,
  readClueDelivery,
  readClueOrders,
  validateClueDelivery,
  withClueDelivery,
  type ClueDelivery,
} from "@/lib/play/clue-delivery";
import { fitOrders, starterOrders } from "@/lib/hunts/clue-order-edits";
import { deliverySettingsChanged } from "@/lib/hunts/delivery-lock";
import { ClueDeliveryPicker } from "@/components/hunts/clue-delivery-picker";
import { ClueOrdersEditor, type StopLabel } from "@/components/hunts/clue-orders-editor";

interface ClueDeliverySettingsProps {
  metadata: Record<string, unknown> | null;
  stops: ReadonlyArray<StopLabel>;
  /** Published or played: shown read-only (the API rejects changes too). */
  locked: boolean;
  busy: boolean;
  onSave: (metadata: Record<string, unknown>, successText: string) => Promise<boolean>;
}

/**
 * Hunt settings section for clue delivery. The creator picks a mode and, for
 * assigned orders, defines the orders; nothing is saved until "Save". Re-mount
 * it (via `key`) when the saved setting or the stops change.
 */
export function ClueDeliverySettings({ metadata, stops, locked, busy, onSave }: ClueDeliverySettingsProps) {
  const findIds = stops.map((s) => s.id);
  const savedMode = readClueDelivery(metadata);
  const savedOrders = fitOrders(readClueOrders(metadata), findIds);
  const [mode, setMode] = useState<ClueDelivery>(savedMode);
  const [orders, setOrders] = useState<string[][]>(savedOrders);

  if (locked) return <LockedView mode={savedMode} orders={savedOrders} stops={stops} />;

  const next = withClueDelivery(metadata, mode, orders);
  const check = validateClueDelivery(next, findIds);
  const dirty = deliverySettingsChanged(metadata, next);

  const chooseMode = (value: ClueDelivery) => {
    setMode(value);
    if (value === "assigned_order" && orders.length === 0) setOrders(starterOrders(findIds));
  };

  return (
    <div className="space-y-3">
      <ClueDeliveryPicker name="clue-delivery" value={mode} onChange={chooseMode} disabled={busy} />
      {mode === "assigned_order" && (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Each player is assigned one of these orders, spread evenly, and keeps it on replays. Repeat an order to
            assign it more often.
          </p>
          <ClueOrdersEditor stops={stops} orders={orders} onChange={setOrders} disabled={busy} />
        </div>
      )}
      {!check.ok && dirty && <p className="text-xs text-red-600" role="alert">{check.error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty || !check.ok}
          onClick={() => onSave(next, `Clue delivery set to "${CLUE_DELIVERY_LABELS[mode]}".`)}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
        >
          Save clue delivery
        </button>
        <span className="text-[11px] text-gray-500">Locks when the hunt is published or first played.</span>
      </div>
    </div>
  );
}

interface LockedViewProps {
  mode: ClueDelivery;
  orders: string[][];
  stops: ReadonlyArray<StopLabel>;
}

function LockedView({ mode, orders, stops }: LockedViewProps) {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-sm text-gray-800">
        <Lock className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
        <span className="font-medium">{CLUE_DELIVERY_LABELS[mode]}</span>
        <span className="text-gray-500">· {CLUE_DELIVERY_DESCRIPTIONS[mode]}</span>
      </p>
      <p className="text-[11px] text-gray-500">
        Locked because this hunt has been published or played. Clone the hunt to use a different setting.
      </p>
      {mode === "assigned_order" && <ClueOrdersEditor stops={stops} orders={orders} onChange={() => {}} readOnly />}
    </div>
  );
}
