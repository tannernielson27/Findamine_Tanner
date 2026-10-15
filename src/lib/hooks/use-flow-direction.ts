"use client";

import { useState } from "react";
import { nextFlowDirection, type FlowDirection, type FlowDirectionState } from "@/lib/motion";

/**
 * Which way a guided flow just moved: 1 forward, -1 back. `key` identifies
 * the visible step; `position` orders steps across the whole flow.
 * Uses the store-previous-value-in-state pattern (no effects, no refs read
 * during render).
 */
export function useFlowDirection(key: string, position: number): FlowDirection {
  const [state, setState] = useState<FlowDirectionState>({ key, position, direction: 1 });
  const next = nextFlowDirection(state, key, position);
  if (next !== state) setState(next);
  return next.direction;
}
