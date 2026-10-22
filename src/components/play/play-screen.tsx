"use client";

import type { ReactNode } from "react";
import { MapPinned } from "lucide-react";
import { useGoogleMaps } from "@/components/maps/use-google-maps";
import { PlayMap } from "@/components/play/play-map";
import { PlayHud } from "@/components/play/play-hud";
import { ProximityPanel } from "@/components/play/proximity-panel";
import { ErrorBanner, GpsBanners, OfflineBanner, PlayBanner } from "@/components/play/play-banners";
import { ThumbZone } from "@/components/play/thumb-zone";
import { ChallengeSheet } from "@/components/play/challenge-sheet";
import { StopResults } from "@/components/play/stop-results";
import { PrimeStep, ReadingCheckStep } from "@/components/play/steps/prime-step";
import { useWakeLock } from "@/lib/play/use-wake-lock";
import { useHeatHaptics, useOnlineStatus } from "@/lib/play/use-play-feedback";
import type { PlaySession } from "@/lib/play/use-play-session";
import type { StopFlow } from "@/lib/play/use-stop-flow";

interface PlayScreenProps {
  huntId: string | undefined;
  session: PlaySession;
  flow: StopFlow;
  /** Celebration, privacy notice toast and safety notice: rendered last, on top. */
  overlays: ReactNode;
}

/**
 * Full-screen play: map behind, HUD on top, thumb zone at the bottom, the
 * challenge in a bottom sheet, and the juniper results screen after a stop.
 * No app chrome; the screen stays awake while it is mounted.
 */
export function PlayScreen({ huntId, session, flow, overlays }: PlayScreenProps) {
  const { finds, currentIndex, completedFinds, huntMeta } = session;
  const { step, hotCold, gpsStatus, userPos, locationConsent, error, setError, hints } = flow;
  const currentFind = finds[currentIndex];
  const stopNumber = currentIndex + 1;
  const online = useOnlineStatus();
  const { unavailableReason } = useGoogleMaps();
  const navigating = step === "navigate";
  const granted = locationConsent === "granted";
  const gpsOk = gpsStatus === "waiting" || gpsStatus === "active";
  const sheetOpen = step === "prime" || step === "reading_check" || step === "challenge";
  const resultsOpen = step === "capture" || step === "feedback";
  const target = currentFind?.locations
    ? { lat: currentFind.locations.latitude, lng: currentFind.locations.longitude }
    : null;

  useWakeLock(true);
  useHeatHaptics(navigating ? hotCold?.zone : null);

  const errorBanner = error ? <ErrorBanner message={error} onDismiss={() => setError(null)} /> : null;
  const hudHint =
    step === "clue" || navigating ? { available: hints.canRequestClueHint, onRequest: hints.requestClueHint } : null;

  return (
    <main className="fixed inset-0 z-[51] overflow-hidden bg-map-ground text-ink">
      <PlayMap location={currentFind?.locations ?? null} userPos={userPos} zone={navigating ? hotCold?.zone ?? null : null} />

      <div className="absolute inset-x-4 top-[calc(12px+env(safe-area-inset-top))] z-10 flex flex-col gap-2.5">
        <PlayHud stopNumber={stopNumber} totalStops={finds.length} completedStops={completedFinds.size} hint={hudHint} />
        {navigating && granted && gpsOk && (
          <ProximityPanel hotCold={hotCold} gpsStatus={gpsStatus} userPos={userPos} target={target} />
        )}
        {!sheetOpen && !resultsOpen && errorBanner}
        {!online && !resultsOpen && <OfflineBanner />}
        {navigating && granted && (
          <GpsBanners gpsStatus={gpsStatus} accuracy={userPos?.accuracy ?? null} onRetry={() => flow.setGpsStatus("waiting")} />
        )}
        {navigating && unavailableReason && (
          <PlayBanner icon={<MapPinned className="h-6 w-6 text-link" aria-hidden="true" />}>
            Map unavailable. You can still follow the clue to find this stop.
          </PlayBanner>
        )}
      </div>

      {(step === "clue" || navigating) && <ThumbZone find={currentFind} flow={flow} />}

      {step === "prime" && currentFind?.primers && (
        <PrimeStep stopNumber={stopNumber} primer={currentFind.primers} onReady={flow.handlePrimeViewed} errorSlot={errorBanner} />
      )}
      {step === "reading_check" && currentFind?.reading_check && (
        <ReadingCheckStep
          stopNumber={stopNumber}
          readingCheck={currentFind.reading_check}
          onPassed={flow.handleReadingCheckPassed}
          onError={setError}
          errorSlot={errorBanner}
        />
      )}
      {step === "challenge" && (
        <ChallengeSheet huntId={huntId} stopNumber={stopNumber} find={currentFind} flow={flow} errorSlot={errorBanner} />
      )}

      {resultsOpen && (
        <StopResults
          key={currentFind?.id}
          huntId={huntId}
          findId={currentFind?.id}
          stopNumber={stopNumber}
          totalStops={finds.length}
          completedStops={completedFinds.size}
          isLastStop={currentIndex === finds.length - 1}
          phase={step === "capture" ? "capture" : "feedback"}
          score={flow.score}
          hideScores={!!huntMeta.hide_scores}
          feedback={flow.feedback}
          breakdown={flow.breakdown}
          alreadyCompleted={completedFinds.has(currentFind?.id || "")}
          error={error}
          noticeVisible={!!flow.privacyNotice}
          uploadingPhoto={flow.uploadingPhoto}
          finishing={flow.finishing}
          onPhoto={flow.handleCapturePhoto}
          onSkipPhoto={flow.handleCaptureSkip}
          onNext={flow.handleNextFind}
          onFinish={flow.handleFinishHunt}
          onPrevious={currentIndex > 0 ? flow.handlePreviousFind : null}
          onDismissError={() => setError(null)}
          onError={setError}
        />
      )}

      {overlays}
    </main>
  );
}
