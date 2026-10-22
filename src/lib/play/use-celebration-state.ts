"use client";

import { useCallback, useState } from "react";
import type { CelebrationIntensity } from "@/lib/play/celebration";

export interface CelebrationState {
  show: boolean;
  message: string;
  sub: string | undefined;
  intensity: CelebrationIntensity;
}

export interface CelebrationControls extends CelebrationState {
  celebrate: (message: string, sub: string | undefined, intensity: CelebrationIntensity) => void;
  close: () => void;
}

/** State for the <Celebration> overlay shared by arrival, stop-complete and hunt-complete beats. */
export function useCelebrationState(): CelebrationControls {
  const [state, setState] = useState<CelebrationState>({
    show: false,
    message: "",
    sub: undefined,
    intensity: "medium",
  });

  const celebrate = useCallback(
    (message: string, sub: string | undefined, intensity: CelebrationIntensity) =>
      setState({ show: true, message, sub, intensity }),
    []
  );
  const close = useCallback(() => setState((s) => ({ ...s, show: false })), []);

  return { ...state, celebrate, close };
}
