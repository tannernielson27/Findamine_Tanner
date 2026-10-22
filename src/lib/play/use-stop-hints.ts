"use client";

import { useCallback, useState } from "react";
import { HttpError, errorMessage, postJson, postJsonStrict } from "@/lib/play/play-api";
import type { Find } from "@/lib/play/play-types";

export interface StopHints {
  /** Clue hints (clue + navigate steps; cost points). */
  clueHintText: string;
  clueHintLevel: number;
  clueHintTotal: number;
  clueHintsUnavailable: boolean;
  /** True while another clue hint can be requested. */
  canRequestClueHint: boolean;
  requestClueHint: () => Promise<void>;
  /** Challenge hints (challenge step; levels 1-4, each can be rated). */
  hintText: string;
  hintLevel: number;
  hintRated: boolean;
  requestHint: () => Promise<void>;
  rateHint: (rating: 1 | -1) => Promise<void>;
  /** Clears everything when the player moves to another stop. */
  resetHints: () => void;
}

/** Clue-hint and challenge-hint state for the current stop. */
export function useStopHints(
  huntId: string | string[] | undefined,
  currentFind: Find | undefined,
  setError: (message: string | null) => void
): StopHints {
  const [hintText, setHintText] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const [hintRated, setHintRated] = useState(false);
  const [clueHintText, setClueHintText] = useState("");
  const [clueHintLevel, setClueHintLevel] = useState(0);
  const [clueHintTotal, setClueHintTotal] = useState(0);
  const [clueHintsUnavailable, setClueHintsUnavailable] = useState(false);

  const resetHints = useCallback(() => {
    setHintText("");
    setHintLevel(0);
    setHintRated(false);
    setClueHintText("");
    setClueHintLevel(0);
    setClueHintTotal(0);
    setClueHintsUnavailable(false);
  }, []);

  const requestClueHint = useCallback(async () => {
    if (!currentFind) return;
    const nextLevel = clueHintLevel + 1;
    try {
      const data = await postJsonStrict<{ hint: string; level: number; total_hints: number }>(
        `/api/v1/play/${huntId}/clue-hint`,
        { find_id: currentFind.id, level: nextLevel }
      );
      setClueHintText(data.hint);
      setClueHintLevel(data.level);
      setClueHintTotal(data.total_hints);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // This stop has no clue hints: say so and take the button away
        setClueHintsUnavailable(true);
      } else {
        setError(errorMessage(err, "Failed to get a clue hint"));
      }
    }
  }, [currentFind, huntId, clueHintLevel, setError]);

  const requestHint = useCallback(async () => {
    if (!currentFind) return;
    const nextLevel = Math.min(4, hintLevel + 1);
    try {
      const data = await postJsonStrict<{ hint: string }>(`/api/v1/play/${huntId}/hint`, {
        find_id: currentFind.id,
        level: nextLevel,
      });
      setHintText(data.hint);
      setHintLevel(nextLevel);
      setHintRated(false); // each new hint can be rated
    } catch (err) {
      setError(errorMessage(err, "Failed to get hint"));
    }
  }, [currentFind, huntId, hintLevel, setError]);

  const rateHint = useCallback(
    async (rating: 1 | -1) => {
      const ok = await postJson("/api/v1/hints/rate", { find_id: currentFind?.id, rating });
      if (ok) setHintRated(true);
      else setError("We couldn't save your hint feedback. Please try again.");
    },
    [currentFind, setError]
  );

  const canRequestClueHint =
    !clueHintsUnavailable && (clueHintLevel < clueHintTotal || (clueHintLevel === 0 && !clueHintText));

  return {
    clueHintText,
    clueHintLevel,
    clueHintTotal,
    clueHintsUnavailable,
    canRequestClueHint,
    requestClueHint,
    hintText,
    hintLevel,
    hintRated,
    requestHint,
    rateHint,
    resetHints,
  };
}
