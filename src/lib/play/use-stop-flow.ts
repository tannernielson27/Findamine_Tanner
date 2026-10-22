"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { celebrationForResult, arrivalCelebration } from "@/lib/play/celebration";
import { hapticSuccess } from "@/lib/native/haptics";
import { errorMessage, postJsonStrict, safeFetch } from "@/lib/play/play-api";
import { useGeoTracking, type GeoTracking } from "@/lib/play/use-geo-tracking";
import { useStopHints, type StopHints } from "@/lib/play/use-stop-hints";
import type { CelebrationControls } from "@/lib/play/use-celebration-state";
import type { PlaySession } from "@/lib/play/use-play-session";
import type { PrivacyNotice } from "@/lib/services/privacy-notice";
import type { AnswerFeedback, HotCold, LocationConsent, StopStep } from "@/lib/play/play-types";

export interface StopFlow extends GeoTracking {
  step: StopStep;
  setStep: Dispatch<SetStateAction<StopStep>>;
  answer: string;
  setAnswer: Dispatch<SetStateAction<string>>;
  feedback: AnswerFeedback | null;
  score: number | null;
  breakdown: Record<string, number> | null;
  canRetry: boolean;
  hotCold: HotCold | null;
  error: string | null;
  setError: (message: string | null) => void;
  locationConsent: LocationConsent;
  setLocationConsent: Dispatch<SetStateAction<LocationConsent>>;
  privacyNotice: PrivacyNotice | null;
  closePrivacyNotice: () => void;
  submitting: boolean;
  finishing: boolean;
  uploadingPhoto: boolean;
  hints: StopHints;
  handlePrimeViewed: () => Promise<void>;
  handleReadingCheckPassed: () => void;
  handleClueRead: () => void;
  handleSkipNav: () => Promise<void>;
  handleSubmitAnswer: () => Promise<void>;
  handleCapturePhoto: (file: File) => Promise<void>;
  handleCaptureSkip: () => void;
  handleNextFind: () => void;
  handlePreviousFind: () => void;
  handleFinishHunt: () => Promise<void>;
}

/**
 * Per-stop state machine: prime → reading check → clue → navigate →
 * challenge → capture → feedback, plus every handler that moves it along.
 */
export function useStopFlow(
  huntId: string | string[] | undefined,
  session: PlaySession,
  celebration: CelebrationControls
): StopFlow {
  const { finds, currentIndex, setCurrentIndex, completedFinds, setCompletedFinds, setSessionScore, huntMeta, finishHunt } = session;
  const { celebrate } = celebration;
  const currentFind = finds[currentIndex];

  const [step, setStep] = useState<StopStep>("prime");
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<AnswerFeedback | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [breakdown, setBreakdown] = useState<Record<string, number> | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [hotCold, setHotCold] = useState<HotCold | null>(null);
  const [error, setErrorState] = useState<string | null>(null);
  // Whether the player has agreed (via the location primer) to share their
  // location for this hunt. GPS only starts once this is "granted", so the
  // system prompt never appears without an explanation first. Kept for the
  // whole hunt so the primer isn't shown again at every stop.
  const [locationConsent, setLocationConsent] = useState<LocationConsent>("pending");
  // Just-in-time privacy notice after a completed find (storyline S6).
  const [privacyNotice, setPrivacyNotice] = useState<PrivacyNotice | null>(null);
  const closePrivacyNotice = useCallback(() => setPrivacyNotice(null), []);
  const [arrivedCelebrated, setArrivedCelebrated] = useState(false);
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const resetForFindRef = useRef<string | null>(null);

  const setError = useCallback((message: string | null) => setErrorState(message), []);
  const hints = useStopHints(huntId, currentFind, setError);
  const { resetHints } = hints;

  const onArrived = useCallback(() => {
    // The "you found it!" beat — the most satisfying moment in a hunt.
    if (!arrivedCelebrated) {
      const beat = arrivalCelebration();
      celebrate(beat.headline, undefined, beat.intensity);
      setArrivedCelebrated(true);
    }
    setStep("challenge");
  }, [arrivedCelebrated, celebrate]);

  const geo = useGeoTracking({ huntId, step, currentFind, locationConsent, onHotCold: setHotCold, onArrived });
  const { setGpsStatus, userPos } = geo;

  // ── Reset step state when changing finds ────────────
  useEffect(() => {
    if (!currentFind) return;
    // Only when the player moves to a different stop. Completing the current
    // stop also changes completedFinds, and resetting then would wipe the
    // results and skip the photo step.
    if (resetForFindRef.current === currentFind.id) return;
    resetForFindRef.current = currentFind.id;
    if (completedFinds.has(currentFind.id)) setStep("feedback");
    else if (currentFind.primers) setStep("prime");
    else setStep("clue");
    setAnswer("");
    setFeedback(null);
    setScore(null);
    setBreakdown(null);
    setCanRetry(false);
    setHotCold(null);
    setArrivedCelebrated(false);
    resetHints();
    setGpsStatus("waiting");
    setErrorState(null);
  }, [currentIndex, currentFind, completedFinds, resetHints, setGpsStatus]);

  const handlePrimeViewed = useCallback(async () => {
    if (!currentFind) return;
    try {
      await postJsonStrict(`/api/v1/play/${huntId}/prime-viewed`, { find_id: currentFind.id });
      // If reading check is enabled, go to reading_check step first
      if (currentFind.reading_check?.enabled && currentFind.reading_check.questions?.length > 0) {
        setStep("reading_check");
      } else {
        setStep("clue");
      }
    } catch (err) {
      setErrorState(errorMessage(err, "Failed to record primer view"));
    }
  }, [currentFind, huntId]);

  const handleReadingCheckPassed = useCallback(() => setStep("clue"), []);
  const handleClueRead = useCallback(() => setStep("navigate"), []);

  const handleSkipNav = useCallback(async () => {
    if (!currentFind) return;
    try {
      // `manual` asks the server to record the arrival without a GPS match.
      // The position is sent when we have one so the record shows how far off it was.
      const data = await postJsonStrict<{ arrived?: boolean }>(`/api/v1/play/${huntId}/arrive`, {
        find_id: currentFind.id,
        manual: true,
        ...(userPos ? { latitude: userPos.lat, longitude: userPos.lng } : {}),
      });
      if (!data.arrived) {
        setErrorState("We couldn't record your arrival at this stop. Please try again.");
        return;
      }
      setStep("challenge");
    } catch (err) {
      setErrorState(errorMessage(err, "Failed to record arrival"));
    }
  }, [currentFind, huntId, userPos]);

  const handleSubmitAnswer = useCallback(async () => {
    if (!currentFind || !answer || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorState(null);

    try {
      const data = await postJsonStrict<Record<string, unknown>>(`/api/v1/play/${huntId}/answer`, {
        find_id: currentFind.id,
        answer,
      });
      const resultFeedback = data.feedback as AnswerFeedback | null;
      const resultScore = data.score as number;
      const resultBreakdown = data.breakdown as Record<string, number> | null;

      setFeedback(resultFeedback);
      setScore(resultScore);
      setBreakdown(resultBreakdown);
      setCanRetry(data.can_retry as boolean);

      if (data.is_complete) {
        setCompletedFinds((prev) => new Set([...prev, currentFind.id]));
        void hapticSuccess();
        // Surface the payoff immediately — points land in the celebration, not
        // buried behind the optional photo step.
        const celeb = celebrationForResult(
          {
            feedbackType: resultFeedback?.type as string,
            score: resultScore,
            attempt: data.attempt as number | undefined,
            breakdown: resultBreakdown,
          },
          !!huntMeta.hide_scores
        );
        const newBadge = Array.isArray(data.badges_earned) && data.badges_earned.length > 0;
        const pointsLine = celeb.points != null ? `+${celeb.points} points` : undefined;
        celebrate(
          celeb.headline,
          newBadge ? [pointsLine, "New badge earned!"].filter(Boolean).join(" · ") : pointsLine,
          celeb.intensity
        );
        if (typeof resultScore === "number" && !huntMeta.hide_scores) {
          setSessionScore((s) => s + resultScore);
        }
        const notice = data.privacy_notice as PrivacyNotice | undefined;
        if (notice?.id) setPrivacyNotice(notice);
        setStep("capture");
      }
    } catch (err) {
      setErrorState(errorMessage(err, "Failed to submit answer"));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [currentFind, huntId, answer, huntMeta.hide_scores, celebrate, setCompletedFinds, setSessionScore]);

  const handleCapturePhoto = useCallback(
    async (file: File) => {
      if (!currentFind || uploadingPhoto) return;
      setUploadingPhoto(true);
      setErrorState(null);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("find_id", currentFind.id);
        await safeFetch(`/api/v1/play/${huntId}/capture`, { method: "POST", body: formData });
        setStep("feedback");
      } catch (err) {
        setErrorState(errorMessage(err, "Failed to upload photo"));
      } finally {
        setUploadingPhoto(false);
      }
    },
    [currentFind, huntId, uploadingPhoto]
  );

  const handleCaptureSkip = useCallback(() => setStep("feedback"), []);

  const handleNextFind = useCallback(() => {
    if (currentIndex < finds.length - 1) setCurrentIndex(currentIndex + 1);
  }, [currentIndex, finds.length, setCurrentIndex]);

  const handlePreviousFind = useCallback(() => {
    setCurrentIndex(Math.max(0, currentIndex - 1));
  }, [currentIndex, setCurrentIndex]);

  const handleFinishHunt = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    setErrorState(null);
    try {
      await finishHunt({
        findsCompleted: completedFinds.size,
        totalFinds: finds.length,
        hideScores: !!huntMeta.hide_scores,
      });
    } catch (err) {
      setErrorState(errorMessage(err, "Failed to complete hunt"));
    } finally {
      setFinishing(false);
    }
  }, [finishing, finishHunt, completedFinds.size, finds.length, huntMeta.hide_scores]);

  return {
    ...geo,
    step,
    setStep,
    answer,
    setAnswer,
    feedback,
    score,
    breakdown,
    canRetry,
    hotCold,
    error,
    setError,
    locationConsent,
    setLocationConsent,
    privacyNotice,
    closePrivacyNotice,
    submitting,
    finishing,
    uploadingPhoto,
    hints,
    handlePrimeViewed,
    handleReadingCheckPassed,
    handleClueRead,
    handleSkipNav,
    handleSubmitAnswer,
    handleCapturePhoto,
    handleCaptureSkip,
    handleNextFind,
    handlePreviousFind,
    handleFinishHunt,
  };
}
