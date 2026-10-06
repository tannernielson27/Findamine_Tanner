"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Camera, RotateCcw, Star, ThumbsDown, ThumbsUp, Trophy, X } from "lucide-react";
import StopFlowStepper from "@/components/play/stop-flow-stepper";
import HotColdMeter from "@/components/play/hot-cold-meter";
import ChallengeInput from "@/components/play/challenge-input";
import NavigateMap from "@/components/maps/navigate-map";
import { Celebration } from "@/components/ui/celebration";
import { PrivacyNoticeToast } from "@/components/play/privacy-notice-toast";
import type { PrivacyNotice } from "@/lib/services/privacy-notice";
import {
  celebrationForResult,
  arrivalCelebration,
  type CelebrationIntensity,
} from "@/lib/play/celebration";

type StopStep = "prime" | "reading_check" | "clue" | "navigate" | "challenge" | "capture" | "feedback";

interface Find {
  id: string;
  sort_order: number;
  clue_text: string | null;
  hot_cold_enabled: boolean;
  scaffolding_level: string | null;
  reading_check: { enabled: boolean; questions: { question: string; options: string[]; correct_answer: string }[] } | null;
  locations: { name: string; latitude: number; longitude: number; radius_meters: number } | null;
  tasks: { title: string; challenge_type: string; content: Record<string, unknown> } | null;
  primers: { title: string; content: Record<string, unknown> } | null;
}

// Hunt metadata for anxiety-sensitive mode and scoring
interface HuntMetadata {
  hide_scores?: boolean;
  hide_leaderboard?: boolean;
  hide_timer?: boolean;
  growth_only_feedback?: boolean;
  scoring_mode?: string;
  preset?: string;
}

interface HotCold {
  zone: string;
  color: string;
  label: string;
  emoji: string;
  distanceLabel: string;
}

// ── Helpers ──────────────────────────────────────────

type GpsStatus = "waiting" | "active" | "denied" | "unavailable" | "timeout";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "Request failed" }));
    throw new HttpError(res.status, body.error || `HTTP ${res.status}`);
  }
  return res;
}

/** POST JSON and report whether the server accepted it. Never throws. */
async function postJson(url: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface StartOptions {
  codename?: string;
  assign_codename?: boolean;
}

// ── Component ────────────────────────────────────────

export default function PlayPage() {
  const { huntId } = useParams();
  const router = useRouter();

  const [finds, setFinds] = useState<Find[]>([]);
  const [huntMeta, setHuntMeta] = useState<HuntMetadata>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [step, setStep] = useState<StopStep>("prime");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<{ type: string; main: string; explanation: string; next_steps: string } | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, number> | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [hotCold, setHotCold] = useState<HotCold | null>(null);
  const [hintText, setHintText] = useState("");
  const [hintLevel, setHintLevel] = useState(0);
  const [hintRated, setHintRated] = useState(false);
  const [readingCheckAnswers, setReadingCheckAnswers] = useState<Record<number, string>>({});
  const [showTechniqueReview, setShowTechniqueReview] = useState(false);
  const [techniqueReviewDone, setTechniqueReviewDone] = useState(false);
  const [reviewStrategies, setReviewStrategies] = useState<string[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSending, setReportSending] = useState(false);
  const [clueHintText, setClueHintText] = useState("");
  const [clueHintLevel, setClueHintLevel] = useState(0);
  const [clueHintTotal, setClueHintTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completedFinds, setCompletedFinds] = useState<Set<string>>(new Set());
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("waiting");
  const [userPos, setUserPos] = useState<{ lat: number; lng: number } | null>(null);
  const [showCelebration, setShowCelebration] = useState(false);
  const [celebrationMessage, setCelebrationMessage] = useState("");
  const [celebrationSub, setCelebrationSub] = useState<string | undefined>(undefined);
  const [celebrationIntensity, setCelebrationIntensity] = useState<CelebrationIntensity>("medium");
  const [sessionScore, setSessionScore] = useState(0);
  // Just-in-time privacy notice after a completed find (storyline S6).
  const [privacyNotice, setPrivacyNotice] = useState<PrivacyNotice | null>(null);
  const closePrivacyNotice = useCallback(() => setPrivacyNotice(null), []);
  const [arrivedCelebrated, setArrivedCelebrated] = useState(false);
  const [huntComplete, setHuntComplete] = useState(false);
  const [huntSummary, setHuntSummary] = useState<{
    totalScore: number;
    findsCompleted: number;
    totalFinds: number;
    startedAt: string;
    completedAt: string;
  } | null>(null);

  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [clueHintsUnavailable, setClueHintsUnavailable] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Hunts with identity mode "codename_chosen" need an explorer name before
  // a session can start.
  const [needsCodename, setNeedsCodename] = useState(false);
  const [codenameInput, setCodenameInput] = useState("");
  const [codenameError, setCodenameError] = useState<string | null>(null);
  // Only one arrive request at a time: watchPosition fires faster than the
  // server answers, and parallel in-radius pings could record two arrivals.
  const arriveInFlightRef = useRef(false);
  const resetForFindRef = useRef<string | null>(null);
  const currentFind = finds[currentIndex];

  // ── Finish the hunt (used by the button and by a reload after the last stop) ──

  const finishHunt = useCallback(
    async (opts: { findsCompleted: number; totalFinds: number; hideScores: boolean }) => {
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
      setCelebrationMessage("Hunt Complete!");
      setCelebrationSub(!opts.hideScores && finalScore ? `${finalScore} points total` : undefined);
      setCelebrationIntensity("high");
      setShowCelebration(true);
    },
    [huntId]
  );

  // ── Initialize ──────────────────────────────────────

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

        // Mark the onboarding "first hunt" milestone (fire-and-forget). Drives
        // the next-steps funnel surfaced after onboarding; never blocks play.
        fetch("/api/v1/onboarding", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ milestone_type: "first_hunt_started" }),
        }).catch(() => {});

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
        const allFinds: Find[] = findsData.finds || [];

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

  // ── Reset step state when changing finds ────────────

  useEffect(() => {
    if (!currentFind) return;
    // Only when the player moves to a different stop. Completing the current
    // stop also changes completedFinds, and resetting then would wipe the
    // results and skip the photo step.
    if (resetForFindRef.current === currentFind.id) return;
    resetForFindRef.current = currentFind.id;
    if (completedFinds.has(currentFind.id)) {
      setStep("feedback");
    } else if (currentFind.primers) {
      setStep("prime");
    } else {
      setStep("clue");
    }
    setAnswer("");
    setFeedback(null);
    setScore(null);
    setBreakdown(null);
    setCanRetry(false);
    setHotCold(null);
    setArrivedCelebrated(false);
    setHintText("");
    setHintLevel(0);
    setHintRated(false);
    setClueHintText("");
    setClueHintLevel(0);
    setClueHintTotal(0);
    setClueHintsUnavailable(false);
    setGpsStatus("waiting");
    setError(null);
    setShowTechniqueReview(false);
    setTechniqueReviewDone(false);
    setReviewStrategies([]);
    setShowReport(false);
    setReportDone(false);
    setReportError(null);
  }, [currentIndex, currentFind, completedFinds]);

  // ── GPS watcher for navigate step ──────────────────

  useEffect(() => {
    if (step !== "navigate" || !currentFind) return;

    if (!navigator.geolocation) {
      setGpsStatus("unavailable");
      return;
    }

    // Set false on cleanup so a reply that lands after the player has moved on
    // (or left this step) can't push the wrong stop into the challenge.
    let active = true;

    const watchId = navigator.geolocation.watchPosition(
      async (pos) => {
        setGpsStatus("active");
        setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        // Skip this fix if the previous ping is still in flight; the next
        // position update will try again.
        if (arriveInFlightRef.current) return;
        arriveInFlightRef.current = true;
        try {
          const res = await safeFetch(`/api/v1/play/${huntId}/arrive`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              find_id: currentFind.id,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }),
          });
          const data = await res.json();
          if (!active) return;

          if (data.hot_cold) setHotCold(data.hot_cold);
          if (data.arrived) {
            // The "you found it!" beat — the most satisfying moment in a hunt.
            if (!arrivedCelebrated) {
              const beat = arrivalCelebration();
              setCelebrationMessage(beat.headline);
              setCelebrationSub(undefined);
              setCelebrationIntensity(beat.intensity);
              setShowCelebration(true);
              setArrivedCelebrated(true);
            }
            setStep("challenge");
          }
        } catch {
          // Network error during GPS ping — don't block navigation,
          // just keep trying on next position update
        } finally {
          arriveInFlightRef.current = false;
        }
      },
      (err) => {
        switch (err.code) {
          case err.PERMISSION_DENIED:
            setGpsStatus("denied");
            break;
          case err.POSITION_UNAVAILABLE:
            setGpsStatus("unavailable");
            break;
          case err.TIMEOUT:
            setGpsStatus("timeout");
            break;
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      active = false;
      navigator.geolocation.clearWatch(watchId);
    };
  }, [step, currentFind, huntId]);

  // ── Handlers ───────────────────────────────────────

  const handlePrimeViewed = useCallback(async () => {
    if (!currentFind) return;
    try {
      await safeFetch(`/api/v1/play/${huntId}/prime-viewed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ find_id: currentFind.id }),
      });
      // If reading check is enabled, go to reading_check step first
      if (currentFind.reading_check?.enabled && currentFind.reading_check.questions?.length > 0) {
        setReadingCheckAnswers({});
        setStep("reading_check");
      } else {
        setStep("clue");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record primer view");
    }
  }, [currentFind, huntId]);

  const handleClueRead = useCallback(() => {
    setStep("navigate");
  }, []);

  const handleClueHint = useCallback(async () => {
    if (!currentFind) return;
    const nextLevel = clueHintLevel + 1;
    try {
      const res = await safeFetch(`/api/v1/play/${huntId}/clue-hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ find_id: currentFind.id, level: nextLevel }),
      });
      const data = await res.json();
      setClueHintText(data.hint);
      setClueHintLevel(data.level);
      setClueHintTotal(data.total_hints);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        // This stop has no clue hints: say so and take the button away
        setClueHintsUnavailable(true);
      } else {
        setError(err instanceof Error ? err.message : "Failed to get a clue hint");
      }
    }
  }, [currentFind, huntId, clueHintLevel]);

  const handleSkipNav = useCallback(async () => {
    if (!currentFind) return;
    try {
      // `manual` asks the server to record the arrival without a GPS match.
      // The position is sent when we have one so the record shows how far off it was.
      const res = await safeFetch(`/api/v1/play/${huntId}/arrive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          find_id: currentFind.id,
          manual: true,
          ...(userPos ? { latitude: userPos.lat, longitude: userPos.lng } : {}),
        }),
      });
      const data = await res.json();
      if (!data.arrived) {
        setError("We couldn't record your arrival at this stop. Please try again.");
        return;
      }
      setStep("challenge");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record arrival");
    }
  }, [currentFind, huntId, userPos]);

  const handleRequestHint = useCallback(async () => {
    if (!currentFind) return;
    const nextLevel = Math.min(4, hintLevel + 1);
    try {
      const res = await safeFetch(`/api/v1/play/${huntId}/hint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ find_id: currentFind.id, level: nextLevel }),
      });
      const data = await res.json();
      setHintText(data.hint);
      setHintLevel(nextLevel);
      setHintRated(false); // each new hint can be rated
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get hint");
    }
  }, [currentFind, huntId, hintLevel]);

  const handleSubmitAnswer = useCallback(async () => {
    if (!currentFind || !answer || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);

    try {
      const res = await safeFetch(`/api/v1/play/${huntId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ find_id: currentFind.id, answer }),
      });
      const data = await res.json();

      setFeedback(data.feedback);
      setScore(data.score);
      setBreakdown(data.breakdown);
      setCanRetry(data.can_retry);

      if (data.is_complete) {
        setCompletedFinds((prev) => new Set([...prev, currentFind.id]));
        // Surface the payoff immediately — points land in the celebration, not
        // buried behind the optional photo step.
        const celeb = celebrationForResult(
          {
            feedbackType: data.feedback?.type,
            score: data.score,
            attempt: data.attempt,
            breakdown: data.breakdown,
          },
          !!huntMeta.hide_scores
        );
        setCelebrationMessage(celeb.headline);
        const newBadge = Array.isArray(data.badges_earned) && data.badges_earned.length > 0;
        const pointsLine = celeb.points != null ? `+${celeb.points} points` : undefined;
        setCelebrationSub(
          newBadge ? [pointsLine, "New badge earned!"].filter(Boolean).join(" · ") : pointsLine
        );
        setCelebrationIntensity(celeb.intensity);
        setShowCelebration(true);
        if (typeof data.score === "number" && !huntMeta.hide_scores) {
          setSessionScore((s) => s + data.score);
        }
        if (data.privacy_notice?.id) setPrivacyNotice(data.privacy_notice as PrivacyNotice);
        setStep("capture");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [currentFind, huntId, answer, huntMeta.hide_scores]);

  const handleRateHint = useCallback(
    async (rating: 1 | -1) => {
      const ok = await postJson("/api/v1/hints/rate", { find_id: currentFind?.id, rating });
      if (ok) setHintRated(true);
      else setError("We couldn't save your hint feedback. Please try again.");
    },
    [currentFind]
  );

  const handleCaptureSkip = useCallback(() => {
    setStep("feedback");
  }, []);

  const handleNextFind = useCallback(() => {
    if (currentIndex < finds.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, finds.length]);

  const handleFinishHunt = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setError(null);
    try {
      await finishHunt({
        findsCompleted: completedFinds.size,
        totalFinds: finds.length,
        hideScores: !!huntMeta.hide_scores,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete hunt");
    } finally {
      setFinishing(false);
    }
  }, [finishing, finishHunt, completedFinds.size, finds.length, huntMeta.hide_scores]);

  // ── Loading / Error states ─────────────────────────

  if (loading) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-themed-border rounded w-1/3" />
          <div className="h-2 bg-themed-border rounded" />
          <div className="h-64 bg-themed-border/60 rounded-xl" />
        </div>
      </main>
    );
  }

  if (needsCodename) {
    const trimmedCodename = codenameInput.trim();
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <form
          className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] p-5 sm:p-8"
          onSubmit={(e) => {
            e.preventDefault();
            if (trimmedCodename) loadHunt({ codename: trimmedCodename });
          }}
        >
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text mb-2">Choose your explorer name</h1>
          <p className="text-base text-themed-muted mb-4">
            This hunt shows players by an explorer name instead of their real name. Pick yours to start.
          </p>
          <label htmlFor="explorer-name" className="block text-sm font-semibold text-themed-text mb-1">
            Explorer name
          </label>
          <input
            id="explorer-name"
            type="text"
            value={codenameInput}
            onChange={(e) => setCodenameInput(e.target.value)}
            maxLength={40}
            autoComplete="off"
            aria-describedby={codenameError ? "explorer-name-error" : undefined}
            aria-invalid={codenameError ? true : undefined}
            className="min-h-12 w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand mb-3"
          />
          {codenameError && (
            <p id="explorer-name-error" role="alert" className="text-base text-error mb-3">{codenameError}</p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={!trimmedCodename}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 sm:flex-1"
            >
              Start Hunt
            </button>
            <button
              type="button"
              onClick={() => loadHunt({ assign_codename: true })}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 sm:flex-1"
            >
              Pick one for me
            </button>
          </div>
        </form>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <div role="alert" className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] px-5 py-8 text-center sm:px-8">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text mb-2">We couldn&apos;t load this hunt</h1>
          <p className="text-base text-themed-muted mb-6">{loadError}</p>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={() => loadHunt()}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Try Again
            </button>
            <button
              onClick={() => router.push("/browse")}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-5 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 sm:w-auto"
            >
              Back to Browse
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (finds.length === 0 && !huntComplete) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12 text-center text-base text-themed-muted">
        This hunt has no stops yet.
      </main>
    );
  }

  // ── Hunt Complete Summary ──────────────────────────

  if (huntComplete) {
    const elapsed = huntSummary?.startedAt && huntSummary?.completedAt
      ? Math.round(
          (new Date(huntSummary.completedAt).getTime() -
            new Date(huntSummary.startedAt).getTime()) /
            60000
        )
      : null;

    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        <Celebration
          show={showCelebration}
          message={celebrationMessage}
          subMessage={celebrationSub}
          intensity={celebrationIntensity}
          onComplete={() => setShowCelebration(false)}
        />

        <div className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] px-5 py-8 text-center sm:px-8">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-secondary/10 text-secondary">
            <Trophy className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text mb-2 text-balance">Hunt Complete!</h1>
          <p className="font-[family-name:var(--font-handwritten)] text-xl text-themed-muted mb-8">You finished all {finds.length} stops</p>

          {huntSummary && (
            <div className="grid grid-cols-3 gap-2 mb-8 sm:gap-4">
              <div className="rounded-xl border border-themed-border bg-themed-bg px-2 py-4 sm:p-5">
                <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-themed-text sm:text-3xl">{huntSummary.totalScore}</div>
                <div className="text-sm text-themed-muted mt-1">Total Points</div>
              </div>
              <div className="rounded-xl border border-themed-border bg-themed-bg px-2 py-4 sm:p-5">
                <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-secondary sm:text-3xl">
                  {huntSummary.findsCompleted}/{huntSummary.totalFinds}
                </div>
                <div className="text-sm text-themed-muted mt-1">Stops Done</div>
              </div>
              <div className="rounded-xl border border-themed-border bg-themed-bg px-2 py-4 sm:p-5">
                <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-themed-text sm:text-3xl">
                  {elapsed !== null ? `${elapsed}m` : "--"}
                </div>
                <div className="text-sm text-themed-muted mt-1">Time</div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <button
              onClick={() => router.push("/dashboard")}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 sm:w-auto"
            >
              Back to Dashboard
            </button>
            <button
              onClick={() => router.push("/browse")}
              className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 w-full px-5 sm:w-auto"
            >
              Find More Hunts
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ── Active Play ────────────────────────────────────

  const totalCompleted = completedFinds.size;
  const isLastFind = currentIndex === finds.length - 1;

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      <Celebration
        show={showCelebration}
        message={celebrationMessage}
        subMessage={celebrationSub}
        intensity={celebrationIntensity}
        onComplete={() => setShowCelebration(false)}
      />

      {privacyNotice && (
        <PrivacyNoticeToast
          key={privacyNotice.id}
          notice={privacyNotice}
          onClose={closePrivacyNotice}
        />
      )}

      {/* Error banner */}
      {error && (
        <div role="alert" className="rounded-lg bg-error/10 border border-error/30 py-2 pl-4 pr-2 mb-4 flex justify-between items-center gap-2">
          <p className="text-base text-error">{error}</p>
          <button onClick={() => setError(null)} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 text-sm font-semibold text-error hover:bg-error/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error">
            Dismiss
          </button>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex flex-wrap justify-between items-center gap-x-3 gap-y-1 mb-2">
        <span className="font-[family-name:var(--font-display)] text-lg font-semibold tabular-nums text-themed-text">
          Stop {currentIndex + 1} of {finds.length}
        </span>
        <div className="flex items-center gap-3">
          {!huntMeta.hide_scores && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-2.5 py-0.5 font-[family-name:var(--font-display)] text-base font-bold text-secondary tabular-nums"
              aria-label={`${sessionScore} points so far`}
            >
              <Star className="h-4 w-4" aria-hidden="true" />
              {sessionScore}
            </span>
          )}
          <span className="font-[family-name:var(--font-handwritten)] text-xl tabular-nums text-secondary">
            {totalCompleted}/{finds.length} done
          </span>
        </div>
      </div>
      <div className="h-2.5 rounded-full bg-themed-border mb-5 overflow-hidden" role="progressbar" aria-valuenow={totalCompleted} aria-valuemin={0} aria-valuemax={finds.length} aria-label={`Hunt progress: ${totalCompleted} of ${finds.length} stops completed`}>
        <div
          className="h-2.5 rounded-full bg-secondary transition-[width] duration-500 ease-out"
          style={{ width: `${(totalCompleted / finds.length) * 100}%` }}
        />
      </div>

      <StopFlowStepper currentStep={step} />

      <div className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] mb-4 min-h-[300px] p-4 sm:p-5" aria-live="polite">
        {/* ── PRIME ── */}
        {step === "prime" && currentFind?.primers && (
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Before You Start</h2>
            <div className="rounded-xl border border-themed-border bg-themed-bg p-4 mb-4">
              <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text mb-2">
                {(currentFind.primers as { title: string }).title}
              </h3>
              <PrimerContent content={(currentFind.primers as { content: Record<string, unknown> }).content} />
            </div>
            <button onClick={handlePrimeViewed} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50">
              I&apos;m Ready!
            </button>
          </div>
        )}

        {/* ── READING CHECK ── */}
        {step === "reading_check" && currentFind?.reading_check && (
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-2">Comprehension Check</h2>
            <p className="text-base text-themed-muted mb-3">Answer these questions about the primer before continuing.</p>

            <div className="space-y-3 mb-4">
              {currentFind.reading_check.questions.map((q, qi) => (
                <div key={qi} className="rounded-xl border border-themed-border bg-surface p-3">
                  <p className="text-base font-semibold text-themed-text mb-2">{qi + 1}. {q.question}</p>
                  <div className="space-y-2">
                    {q.options.map((opt, oi) => (
                      <button
                        key={oi}
                        onClick={() => setReadingCheckAnswers({ ...readingCheckAnswers, [qi]: opt })}
                        className={`flex min-h-11 w-full items-center text-left rounded-lg border-2 px-3 py-2 text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                          readingCheckAnswers[qi] === opt
                            ? "border-link bg-link/10 font-semibold text-themed-text"
                            : "border-themed-border bg-surface text-themed-text hover:bg-themed-bg"
                        }`}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => {
                const questions = currentFind.reading_check!.questions;
                const correct = questions.filter((q, i) => readingCheckAnswers[i] === q.correct_answer).length;
                const pct = Math.round((correct / questions.length) * 100);
                if (pct >= 75) {
                  setStep("clue");
                } else {
                  setError(`You got ${correct}/${questions.length} correct (${pct}%). Need 75% to continue. Try again!`);
                  setReadingCheckAnswers({});
                }
              }}
              disabled={Object.keys(readingCheckAnswers).length < (currentFind.reading_check.questions?.length || 0)}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
            >
              Check Answers
            </button>
          </div>
        )}

        {/* ── CLUE ── */}
        {step === "clue" && (
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Your Clue</h2>
            <div className="rounded-xl border-l-4 border-secondary bg-themed-bg p-4 mb-4">
              <p className="font-[family-name:var(--font-display)] text-xl leading-snug text-themed-text">
                {currentFind?.clue_text || "Head to the next location!"}
              </p>
            </div>
            {currentFind?.locations && (
              <p className="text-base text-themed-muted mb-4">
                Heading to: {(currentFind.locations as { name: string }).name}
              </p>
            )}
            {clueHintText && (
              <div className="rounded-lg border border-link/30 bg-link/10 p-3 mb-4">
                <p className="text-sm font-semibold text-link mb-1">Clue Hint {clueHintLevel}</p>
                <p className="text-base text-themed-text">{clueHintText}</p>
              </div>
            )}
            {clueHintsUnavailable && (
              <p role="status" className="text-base text-themed-muted mb-4">There are no clue hints for this stop.</p>
            )}
            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              {!clueHintsUnavailable && (clueHintLevel < clueHintTotal || (clueHintLevel === 0 && !clueHintText)) ? (
                <button
                  onClick={handleClueHint}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 sm:flex-1"
                >
                  Need a hint? (-2 pts)
                </button>
              ) : null}
              <button onClick={handleClueRead} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 sm:flex-1">
                Start Navigating
              </button>
            </div>
          </div>
        )}

        {/* ── NAVIGATE ── */}
        {step === "navigate" && (
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-2">Navigate to Location</h2>
            <p className="text-base text-themed-muted mb-4">
              Walk toward <strong className="text-themed-text">{currentFind?.locations ? (currentFind.locations as { name: string }).name : "the target"}</strong>
            </p>

            {/* GPS error states */}
            {gpsStatus === "denied" && (
              <div role="alert" className="rounded-xl bg-error/10 border border-error/30 p-4 mb-4">
                <p className="text-base font-semibold text-error mb-1">Location Access Denied</p>
                <p className="text-base text-themed-text mb-3">
                  Please enable location access in your browser settings to use GPS navigation.
                </p>
                <button
                  onClick={handleSkipNav}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  Skip to Challenge
                </button>
              </div>
            )}

            {gpsStatus === "unavailable" && (
              <div role="alert" className="rounded-xl bg-warning/10 border border-warning/30 p-4 mb-4">
                <p className="text-base font-semibold text-warning mb-1">GPS Not Available</p>
                <p className="text-base text-themed-text mb-3">
                  Your device doesn&apos;t have GPS or it&apos;s not working right now.
                </p>
                <button
                  onClick={handleSkipNav}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  Skip to Challenge
                </button>
              </div>
            )}

            {gpsStatus === "timeout" && (
              <div role="alert" className="rounded-xl bg-warning/10 border border-warning/30 p-4 mb-4">
                <p className="text-base font-semibold text-warning mb-1">GPS Signal Weak</p>
                <p className="text-base text-themed-text mb-3">
                  Try moving to an open area for better signal, or skip navigation.
                </p>
                <button
                  onClick={() => setGpsStatus("waiting")}
                  className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 mb-3 w-full"
                >
                  <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  Try Again
                </button>
                <button
                  onClick={handleSkipNav}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  Skip to Challenge
                </button>
              </div>
            )}

            {/* Active GPS / waiting states */}
            {(gpsStatus === "waiting" || gpsStatus === "active") && (
              <>
                {/* Map + Hot/Cold side by side */}
                {currentFind?.locations && (
                  <div className="mb-4">
                    <NavigateMap
                      targetLat={(currentFind.locations as { latitude: number }).latitude}
                      targetLng={(currentFind.locations as { longitude: number }).longitude}
                      radiusMeters={(currentFind.locations as { radius_meters: number }).radius_meters || 50}
                      userLat={userPos?.lat ?? null}
                      userLng={userPos?.lng ?? null}
                      zone={hotCold?.zone ?? null}
                    />
                  </div>
                )}

                {hotCold ? (
                  <div className="flex justify-center mb-4">
                    <HotColdMeter
                      zone={hotCold.zone}
                      color={hotCold.color}
                      label={hotCold.label}
                      emoji={hotCold.emoji}
                      distance={hotCold.distanceLabel}
                    />
                  </div>
                ) : gpsStatus === "active" ? (
                  // GPS is working but there is no hot/cold reading to show
                  // (the stop has it turned off, or the last ping failed).
                  <p className="mb-4 text-base text-themed-muted" role="status">
                    GPS is on. Head to the location and we&apos;ll let you know when you arrive.
                  </p>
                ) : (
                  <div className="mb-4" role="status">
                    <div className="animate-pulse flex justify-center">
                      <div className="w-16 h-16 rounded-full bg-link/10 flex items-center justify-center text-2xl">
                        <svg aria-hidden="true" className="animate-spin h-8 w-8 text-link" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                    </div>
                    <p className="text-base text-themed-muted mt-2">Acquiring GPS signal...</p>
                  </div>
                )}

                {/* Clue hints during navigation */}
                {clueHintText && (
                  <div className="rounded-lg border border-link/30 bg-link/10 p-3 mb-3 text-left">
                    <p className="text-sm font-semibold text-link mb-1">Clue Hint {clueHintLevel}</p>
                    <p className="text-base text-themed-text">{clueHintText}</p>
                  </div>
                )}
                {clueHintsUnavailable && (
                  <p role="status" className="text-base text-themed-muted mb-2">There are no clue hints for this stop.</p>
                )}
                {!clueHintsUnavailable && (clueHintLevel < clueHintTotal || (clueHintLevel === 0 && !clueHintText)) && (
                  <button
                    onClick={handleClueHint}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 mb-2 w-full"
                  >
                    Stuck? Get a clue hint (-2 pts)
                  </button>
                )}

                <button
                  onClick={handleSkipNav}
                  className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-link underline-offset-2 transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 underline"
                >
                  I&apos;m already here (skip navigation)
                </button>
              </>
            )}
          </div>
        )}

        {/* ── CHALLENGE ── */}
        {step === "challenge" && (
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Challenge</h2>

            {currentFind?.tasks && (
              <div className="rounded-xl border-l-4 border-secondary bg-themed-bg p-4 mb-4">
                <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text">
                  {(currentFind.tasks as { title: string }).title}
                </h3>
              </div>
            )}

            {/* Hint section */}
            {hintText && (
              <div className="rounded-lg border border-link/30 bg-link/10 p-3 mb-4">
                <p className="text-base text-themed-text">
                  <strong>Hint (Level {hintLevel}):</strong> {hintText}
                </p>
                {!hintRated && (
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-sm text-themed-muted" id="hint-helpful-label">Was this helpful?</span>
                    <button
                      aria-label="Hint was helpful"
                      aria-describedby="hint-helpful-label"
                      onClick={() => handleRateHint(1)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-themed-border bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 text-secondary hover:bg-secondary/10"
                    >
                      <ThumbsUp className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button
                      aria-label="Hint was not helpful"
                      aria-describedby="hint-helpful-label"
                      onClick={() => handleRateHint(-1)}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-themed-border bg-surface transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 text-error hover:bg-error/10"
                    >
                      <ThumbsDown className="h-5 w-5" aria-hidden="true" />
                    </button>
                  </div>
                )}
                {hintRated && <p className="text-sm text-themed-muted mt-1">Thanks for the feedback!</p>}
              </div>
            )}

            {/* Feedback from previous attempt */}
            {feedback && canRetry && (
              <div className={`rounded-lg border p-3 mb-4 text-themed-text ${
                feedback.type === "correct" ? "border-secondary/30 bg-secondary/10" :
                feedback.type === "partial" ? "border-link/30 bg-link/10" :
                "border-warning/30 bg-warning/10"
              }`}>
                <p className="text-base font-semibold">{feedback.main}</p>
                <p className="text-sm mt-1">{feedback.explanation}</p>
              </div>
            )}

            {/* Challenge-type-specific input */}
            <div className="mb-2">
              <ChallengeInput
                challengeType={currentFind?.tasks?.challenge_type || "short_text"}
                content={currentFind?.tasks?.content || {}}
                answer={answer}
                onAnswerChange={setAnswer}
                onSubmit={handleSubmitAnswer}
                disabled={submitting}
              />
              {submitting && (
                <p role="status" className="mt-2 text-center text-sm text-themed-muted">Checking your answer...</p>
              )}
            </div>

            <button
              onClick={handleRequestHint}
              disabled={hintLevel >= 4}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-link transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:text-themed-muted"
            >
              {hintLevel === 0 ? "Need a hint?" : hintLevel < 4 ? `Get more help (Level ${hintLevel + 1})` : "No more hints available"}
            </button>
          </div>
        )}

        {/* ── CAPTURE ── */}
        {step === "capture" && (
          <div className="text-center">
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-2">Geo-Selfie!</h2>
            <p className="text-base text-themed-muted mb-6">
              Take a photo of yourself at this location to remember your adventure!
            </p>

            <label className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 mb-2 ${uploadingPhoto ? "cursor-wait opacity-50" : "cursor-pointer"}`}>
              <Camera className="h-5 w-5" aria-hidden="true" />
              <span aria-live="polite">{uploadingPhoto ? "Uploading photo..." : "Take Photo"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={uploadingPhoto}
                onChange={async (e) => {
                  const input = e.target;
                  const file = input.files?.[0];
                  if (!file || !currentFind || uploadingPhoto) return;
                  setUploadingPhoto(true);
                  setError(null);
                  try {
                    const formData = new FormData();
                    formData.append("file", file);
                    formData.append("find_id", currentFind.id);
                    await safeFetch(`/api/v1/play/${huntId}/capture`, {
                      method: "POST",
                      body: formData,
                    });
                    setStep("feedback");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Failed to upload photo");
                    // Let the same photo be picked again after a failure
                    input.value = "";
                  } finally {
                    setUploadingPhoto(false);
                  }
                }}
              />
            </label>

            <div>
              <button onClick={handleCaptureSkip} disabled={uploadingPhoto} className="disabled:opacity-50inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-link underline-offset-2 transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 underline">
                Skip photo
              </button>
            </div>
          </div>
        )}

        {/* ── FEEDBACK ── */}
        {step === "feedback" && (
          <div>
            <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-3">Results</h2>

            {score !== null && !huntMeta.hide_scores && (
              <div className="text-center mb-4">
                <div className="font-[family-name:var(--font-display)] text-5xl font-bold tabular-nums text-secondary">{score}</div>
                <p className="text-base text-themed-muted">points earned</p>
              </div>
            )}
            {score !== null && huntMeta.hide_scores && (
              <div className="text-center mb-4">
                <div className="font-[family-name:var(--font-display)] text-4xl font-bold text-secondary">Complete!</div>
                <p className="text-base text-themed-muted">Great effort on this stop</p>
              </div>
            )}

            {feedback && (
              <div className={`rounded-lg border p-4 mb-4 text-themed-text ${
                feedback.type === "correct" ? "border-secondary/30 bg-secondary/10" :
                feedback.type === "partial" ? "border-link/30 bg-link/10" :
                "border-warning/30 bg-warning/10"
              }`}>
                <p className="text-base font-semibold">{feedback.main}</p>
                <p className="text-base mt-1">{feedback.explanation}</p>
                <p className="text-sm mt-2 italic text-themed-muted">{feedback.next_steps}</p>
              </div>
            )}

            {breakdown && (
              <div className="space-y-2 mb-4">
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-lg border border-themed-border bg-themed-bg p-2">
                    <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{breakdown.correctness}</div>
                    <div className="text-themed-muted">Accuracy</div>
                  </div>
                  <div className="rounded-lg border border-themed-border bg-themed-bg p-2">
                    <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{breakdown.masteryBonus}</div>
                    <div className="text-themed-muted">Mastery</div>
                  </div>
                  <div className="rounded-lg border border-themed-border bg-themed-bg p-2">
                    <div className="font-[family-name:var(--font-display)] text-lg font-bold tabular-nums text-themed-text">{breakdown.completion}</div>
                    <div className="text-themed-muted">Completion</div>
                  </div>
                </div>
                {/* hintPenalty is the server's total: clue hints plus challenge hints */}
                {breakdown.hintPenalty > 0 && (
                  <div className="text-sm tabular-nums text-themed-muted text-center">
                    Hints used: -{breakdown.hintPenalty} pts
                  </div>
                )}
              </div>
            )}

            {/* Technique review (optional post-challenge reflection) */}
            {score !== null && !techniqueReviewDone && (
              <div className="mt-3">
                {!showTechniqueReview ? (
                  <button
                    onClick={() => setShowTechniqueReview(true)}
                    className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-link underline-offset-2 transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                  >
                    Reflect on your approach (optional)
                  </button>
                ) : (
                  <div className="rounded-lg border border-link/30 bg-link/10 p-3">
                    <p className="text-sm font-semibold text-themed-text mb-2" id="review-strategies-label">What helped you?</p>
                    <div className="flex flex-wrap gap-2 mb-3" role="group" aria-labelledby="review-strategies-label">
                      {[
                        { key: "read_carefully", label: "Read carefully" },
                        { key: "used_hint", label: "Used a hint" },
                        { key: "talked_with_team", label: "Talked with team" },
                        { key: "tried_and_learned", label: "Tried & learned" },
                        { key: "remembered", label: "Remembered from primer" },
                        { key: "guessed", label: "Guessed" },
                      ].map((s) => {
                        const selected = reviewStrategies.includes(s.key);
                        return (
                          <button
                            key={s.key}
                            type="button"
                            aria-pressed={selected}
                            onClick={() =>
                              setReviewStrategies((prev) =>
                                prev.includes(s.key) ? prev.filter((k) => k !== s.key) : [...prev, s.key]
                              )
                            }
                            className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 ${
                              selected ? "border-link bg-link text-white" : "border-themed-border bg-surface text-themed-text hover:bg-themed-bg"
                            }`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-sm font-semibold text-themed-text mb-1" id="review-confidence-label">How confident are you?</p>
                    <div className="flex gap-2 mb-2" role="group" aria-labelledby="review-confidence-label">
                      {[
                        { emoji: "😞", label: "Not confident" },
                        { emoji: "😐", label: "Somewhat confident" },
                        { emoji: "😊", label: "Very confident" },
                      ].map((c, i) => (
                        <button
                          key={i}
                          type="button"
                          aria-label={c.label}
                          className="inline-flex h-12 w-12 items-center justify-center rounded-lg text-2xl leading-none transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
                          onClick={async () => {
                            const ok = await postJson("/api/v1/technique-review", {
                              hunt_id: huntId,
                              confidence: i + 1,
                              strategies: reviewStrategies,
                            });
                            if (!ok) {
                              setError("We couldn't save your reflection. Please try again.");
                              return;
                            }
                            setTechniqueReviewDone(true);
                            setShowTechniqueReview(false);
                          }}
                        >
                          <span aria-hidden="true">{c.emoji}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {techniqueReviewDone && (
              <p className="text-sm text-secondary mt-2">Thanks for reflecting!</p>
            )}

            {/* Show "completed" for revisited finds that have no live score */}
            {score === null && completedFinds.has(currentFind?.id || "") && (
              <div className="text-center py-8 text-themed-muted">
                <p className="text-base">You already completed this stop.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-3">
        <button
          onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
          className="flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40 shrink-0 px-5"
        >
          Previous
        </button>

        {step === "feedback" && (
          isLastFind ? (
            <button
              onClick={handleFinishHunt}
              disabled={finishing}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 flex-1 sm:ml-auto sm:w-auto sm:flex-none sm:px-8"
            >
              {finishing ? "Finishing..." : "Finish Hunt"}
            </button>
          ) : (
            <button
              onClick={handleNextFind}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50 flex-1 sm:ml-auto sm:w-auto sm:flex-none sm:px-8"
            >
              Next Stop
            </button>
          )
        )}
      </div>

      {/* Report a problem — accessible inline disclosure (no prompt/alert) */}
      <div className="mt-4 text-center">
        {reportDone ? (
          <p role="status" className="text-sm text-themed-muted">Thanks for reporting. A teacher will review this.</p>
        ) : !showReport ? (
          <button
            onClick={() => setShowReport(true)}
            aria-expanded={false}
            className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-themed-muted underline underline-offset-2 transition-colors hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            Report a problem
          </button>
        ) : (
          <div className="inline-block rounded-xl border border-themed-border bg-surface p-3 text-left">
            <p className="text-sm font-semibold text-themed-text mb-2" id="report-label">What&apos;s the issue?</p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="report-label">
              {[
                { key: "mean_hurtful", label: "Mean / hurtful" },
                { key: "inappropriate", label: "Inappropriate" },
                { key: "spam", label: "Spam" },
                { key: "off_topic", label: "Off-topic" },
                { key: "other", label: "Other" },
              ].map((c) => (
                <button
                  key={c.key}
                  type="button"
                  disabled={reportSending}
                  onClick={async () => {
                    setReportSending(true);
                    setReportError(null);
                    try {
                      await safeFetch("/api/v1/reports", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          category: c.key,
                          target_type: "find",
                          target_id: currentFind?.id || huntId,
                        }),
                      });
                      setShowReport(false);
                      setReportDone(true);
                    } catch (err) {
                      // Show the server's own reason (rate limit, invalid report, save failure).
                      setReportError(
                        err instanceof HttpError
                          ? err.message
                          : "We couldn't send your report. Check your connection and try again."
                      );
                    } finally {
                      setReportSending(false);
                    }
                  }}
                  className="inline-flex min-h-11 items-center rounded-full border border-themed-border bg-themed-bg px-3 text-sm text-themed-text transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50"
                >
                  {c.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowReport(false);
                  setReportError(null);
                }}
                className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm text-themed-muted transition-colors hover:text-themed-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Cancel
              </button>
            </div>
            {reportError && (
              <p role="alert" className="mt-2 max-w-xs text-sm font-medium text-error">
                {reportError}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

// ── Primer Content Renderer ──────────────────────────

function PrimerContent({ content }: { content: Record<string, unknown> }) {
  const text = (content.text as string) || "";
  const imageUrl = (content.image_url as string) || (content.imageUrl as string) || "";
  const videoUrl = (content.video_url as string) || (content.videoUrl as string) || "";
  const items = content.items as string[] | undefined;

  return (
    <div className="space-y-3">
      {text && <p className="text-base text-themed-text">{text}</p>}

      {items && items.length > 0 && (
        <ul className="list-disc list-inside text-base text-themed-text space-y-1">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      )}

      {imageUrl && (
        <img
          src={imageUrl}
          alt="Primer illustration"
          className="rounded-lg max-h-48 mx-auto"
        />
      )}

      {videoUrl && (
        <div className="aspect-video rounded-lg overflow-hidden">
          <iframe
            src={videoUrl}
            title="Primer video"
            className="w-full h-full"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin"
          />
        </div>
      )}

      {/* Fallback: if content has no recognized fields, show raw text */}
      {!text && !imageUrl && !videoUrl && !items && (
        <p className="text-base text-themed-text">
          {typeof content === "string" ? content : "Review this concept before continuing."}
        </p>
      )}
    </div>
  );
}
