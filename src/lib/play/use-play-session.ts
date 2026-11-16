"use client";

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { HttpError, safeFetch } from "@/lib/play/play-api";
import type { CelebrationControls } from "@/lib/play/use-celebration-state";
import type { Find, HuntMetadata, HuntSummaryData, StartOptions } from "@/lib/play/play-types";
import { readClueDelivery, sessionStopOrder, type ClueDelivery } from "@/lib/play/clue-delivery";

export interface FinishOptions {
  findsCompleted: number;
  totalFinds: number;
  hideScores: boolean;
}

export interface PlaySession {
  finds: Find[];
  huntMeta: HuntMetadata;
  /** How this hunt hands out clues. */
  delivery: ClueDelivery;
  /** all_at_once: the list of open clues, where the player picks one. */
  clueBoardOpen: boolean;
  setClueBoardOpen: Dispatch<SetStateAction<boolean>>;
  currentIndex: number;
  setCurrentIndex: Dispatch<SetStateAction<number>>;
  completedFinds: Set<string>;
  setCompletedFinds: Dispatch<SetStateAction<Set<string>>>;
  sessionScore: number;
  setSessionScore: Dispatch<SetStateAction<number>>;
  loading: boolean;
  loadError: string | null;
  needsCodename: boolean;
  codenameError: string | null;
  huntComplete: boolean;
  huntSummary: HuntSummaryData | null;
  loadHunt: (startOptions?: StartOptions) => Promise<void>;
  finishHunt: (opts: FinishOptions) => Promise<void>;
}

/** Marks the onboarding "first hunt" milestone. Fire-and-forget; never blocks play. */
function markFirstHuntStarted(): void {
  fetch("/api/v1/onboarding", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ milestone_type: "first_hunt_started" }),
  }).catch(() => {});
}

/**
 * Starts (or resumes) the play session, loads the stops and progress, and
 * finishes the hunt. Owns hunt-level state; per-stop state lives in useStopFlow.
 */
export function usePlaySession(huntId: string | string[] | undefined, celebration: CelebrationControls): PlaySession {
  const [finds, setFinds] = useState<Find[]>([]);
  const [huntMeta, setHuntMeta] = useState<HuntMetadata>({});
  const [clueBoardOpen, setClueBoardOpen] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedFinds, setCompletedFinds] = useState<Set<string>>(new Set());
  const [sessionScore, setSessionScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Hunts with identity mode "codename_chosen" need an explorer name before
  // a session can start.
  const [needsCodename, setNeedsCodename] = useState(false);
  const [codenameError, setCodenameError] = useState<string | null>(null);
  const [huntComplete, setHuntComplete] = useState(false);
  const [huntSummary, setHuntSummary] = useState<HuntSummaryData | null>(null);
  const { celebrate } = celebration;

  // ── Finish the hunt (used by the button and by a reload after the last stop) ──
  const finishHunt = useCallback(
    async (opts: FinishOptions) => {
      await safeFetch(`/api/v1/play/${huntId}/complete`, { method: "POST" });

      // Build summary from progress data
      const progressRes = await safeFetch(`/api/v1/play/${huntId}/progress`);
      const progress = await progressRes.json();
      const finalScore = progress.session?.total_score || 0;

      setHuntSummary({
        totalScore: finalScore,
        findsCompleted: opts.findsCompleted,
        totalFinds: opts.totalFinds,
        startedAt: progress.session?.started_at || "",
        completedAt: progress.session?.completed_at || new Date().toISOString(),
      });
      setHuntComplete(true);
      celebrate(
        "Hunt Complete!",
        !opts.hideScores && finalScore ? `${finalScore} points total` : undefined,
        "high"
      );
    },
    [huntId, celebrate]
  );

  const loadHunt = useCallback(
    async (startOptions?: StartOptions) => {
      setLoading(true);
      setLoadError(null);
      setCodenameError(null);
      try {
        const startRes = await fetch(`/api/v1/play/${huntId}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(startOptions || {}),
        });
        if (!startRes.ok) {
          const startBody = await startRes.json().catch(() => ({}));
          // The hunt wants the player to pick an explorer name first.
          if (startBody.needs_codename) {
            setNeedsCodename(true);
            return;
          }
          // The chosen name is taken: stay on the prompt and say so.
          if (startRes.status === 409 && startOptions?.codename) {
            setNeedsCodename(true);
            setCodenameError(startBody.error || "That name is taken. Try another.");
            return;
          }
          throw new HttpError(startRes.status, startBody.error || `HTTP ${startRes.status}`);
        }
        setNeedsCodename(false);
        const startBody = (await startRes.json().catch(() => ({}))) as {
          session?: { id?: string };
          clue_order_index?: number | null;
          /** Assigned orders: this player's own order (the hunt's orders stay on the server). */
          clue_order?: string[] | null;
        };

        // Drives the next-steps funnel surfaced after onboarding.
        markFirstHuntStarted();

        const [findsRes, progressRes, meta] = await Promise.all([
          safeFetch(`/api/v1/hunts/${huntId}/finds`),
          safeFetch(`/api/v1/play/${huntId}/progress`),
          // Hunt metadata for anxiety-sensitive mode and scoring config (non-critical)
          safeFetch(`/api/v1/hunts/${huntId}`)
            .then((r) => r.json())
            .then((d) => (d.hunt?.metadata || {}) as HuntMetadata)
            .catch(() => ({}) as HuntMetadata),
        ]);

        const findsData = await findsRes.json();
        const progressData = await progressRes.json();
        // This session's order (random or assigned orders differ per player),
        // stable across reloads. The server enforces the same order.
        const allFinds: Find[] = sessionStopOrder((findsData.finds || []) as Find[], {
          huntMetadata: meta as Record<string, unknown>,
          sessionId: startBody.session?.id ?? progressData.session?.id,
          orderIndex: startBody.clue_order_index ?? progressData.session?.metadata?.clue_order_index ?? null,
          ownOrder: startBody.clue_order ?? null,
        });

        const doneCompletions = (progressData.completions || []).filter(
          (c: { completed_at: string | null }) => c.completed_at
        );
        const completed = new Set<string>(
          doneCompletions.map((c: { find_id: string }) => c.find_id)
        );

        // Seed the running-score chip from work already done this session.
        const priorScore = (progressData.session?.total_score as number | undefined) ??
          doneCompletions.reduce(
            (sum: number, c: { score?: number }) => sum + (c.score || 0),
            0
          );

        setHuntMeta(meta);
        setFinds(allFinds);
        setCompletedFinds(completed);
        setSessionScore(priorScore);

        // Jump to first incomplete
        const nextIdx = allFinds.findIndex((f: Find) => !completed.has(f.id));
        if (nextIdx >= 0) {
          setCurrentIndex(nextIdx);
          // All clues at once: start on the list of open clues when there is a choice.
          const openCount = allFinds.filter((f) => !completed.has(f.id)).length;
          setClueBoardOpen(readClueDelivery(meta as Record<string, unknown>) === "all_at_once" && openCount > 1);
        } else if (allFinds.length > 0) {
          // Every stop is done but the hunt was never finished (the page was
          // reloaded before "Finish Hunt"). Finish it now so the session is
          // completed and the summary has real numbers. If that fails, land
          // on the last stop, where the Finish Hunt button is.
          setCurrentIndex(allFinds.length - 1);
          try {
            await finishHunt({
              findsCompleted: allFinds.filter((f) => completed.has(f.id)).length,
              totalFinds: allFinds.length,
              hideScores: !!meta.hide_scores,
            });
          } catch {
            // Finish Hunt stays available on the last stop.
          }
        }
      } catch (err) {
        // A failed start must land on the error screen with a retry, never on
        // a stale codename prompt or the "no stops" empty state.
        setNeedsCodename(false);
        setLoadError(err instanceof Error ? err.message : "Failed to load hunt");
      } finally {
        setLoading(false);
      }
    },
    [huntId, finishHunt]
  );

  useEffect(() => {
    loadHunt();
  }, [loadHunt]);

  return {
    finds,
    huntMeta,
    delivery: readClueDelivery(huntMeta as Record<string, unknown>),
    clueBoardOpen,
    setClueBoardOpen,
    currentIndex,
    setCurrentIndex,
    completedFinds,
    setCompletedFinds,
    sessionScore,
    setSessionScore,
    loading,
    loadError,
    needsCodename,
    codenameError,
    huntComplete,
    huntSummary,
    loadHunt,
    finishHunt,
  };
}
