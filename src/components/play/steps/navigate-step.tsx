"use client";

import { RotateCcw } from "lucide-react";
import HotColdMeter from "@/components/play/hot-cold-meter";
import NavigateMap from "@/components/maps/navigate-map";
import { SafetyReminder, StopSafetyNote } from "@/components/play/safety-tips";
import { PermissionDeniedNotice, PermissionPrimer } from "@/components/permissions/permission-primer";
import { ClueHintPanel } from "./clue-step";
import type { StopFlow } from "@/lib/play/use-stop-flow";
import type { Find } from "@/lib/play/play-types";

const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40";

/** Manual check-in: the fallback whenever GPS can't be used for a stop. */
function SkipNavButton({ onClick, label = "Skip to Challenge" }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className={PRIMARY}>
      {label}
    </button>
  );
}

interface NavigateStepProps {
  find: Find | undefined;
  flow: StopFlow;
}

/** Walk to the stop: location primer, GPS states, map, hot/cold and the manual fallback. */
export function NavigateStep({ find, flow }: NavigateStepProps) {
  const { locationConsent, setLocationConsent, gpsStatus, setGpsStatus, handleSkipNav, hotCold, userPos, hints } = flow;
  const granted = locationConsent === "granted";

  return (
    <div className="text-center">
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-2">Navigate to Location</h2>
      <p className="text-base text-themed-muted mb-4">
        Walk toward <strong className="text-themed-text">{find?.locations ? find.locations.name : "the target"}</strong>
      </p>
      <SafetyReminder />
      <StopSafetyNote notes={find?.locations?.safety_notes} />

      {/* Explain location before the OS prompt (App Store 5.1.1) */}
      {locationConsent === "pending" && (
        <PermissionPrimer
          kind="location"
          onContinue={() => setLocationConsent("granted")}
          onDismiss={() => setLocationConsent("declined")}
          deniedActions={<SkipNavButton onClick={handleSkipNav} />}
        />
      )}

      {locationConsent === "declined" && (
        <div role="status" className="rounded-xl border border-themed-border bg-surface p-4 mb-4">
          <p className="text-base font-semibold text-themed-text mb-1">Playing without location</p>
          <p className="text-base text-themed-muted mb-3">
            Findamine can&apos;t tell when you reach this stop, so check in yourself when you get there.
          </p>
          <div className="flex flex-col gap-2">
            <SkipNavButton onClick={handleSkipNav} label="I'm here, go to the challenge" />
            <button onClick={() => setLocationConsent("granted")} className={`${SECONDARY} w-full`}>
              Use my location instead
            </button>
          </div>
        </div>
      )}

      {/* GPS error states */}
      {granted && gpsStatus === "denied" && (
        <PermissionDeniedNotice kind="location">
          <p className="text-base text-themed-muted">You can still play: check in yourself when you reach the stop.</p>
          <SkipNavButton onClick={handleSkipNav} />
        </PermissionDeniedNotice>
      )}

      {granted && gpsStatus === "unavailable" && (
        <div role="alert" className="rounded-xl bg-warning/10 border border-warning/30 p-4 mb-4">
          <p className="text-base font-semibold text-warning mb-1">GPS Not Available</p>
          <p className="text-base text-themed-text mb-3">
            Your device doesn&apos;t have GPS or it&apos;s not working right now.
          </p>
          <SkipNavButton onClick={handleSkipNav} />
        </div>
      )}

      {granted && gpsStatus === "timeout" && (
        <div role="alert" className="rounded-xl bg-warning/10 border border-warning/30 p-4 mb-4">
          <p className="text-base font-semibold text-warning mb-1">GPS Signal Weak</p>
          <p className="text-base text-themed-text mb-3">
            Try moving to an open area for better signal, or skip navigation.
          </p>
          <button onClick={() => setGpsStatus("waiting")} className={`${SECONDARY} mb-3 w-full`}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try Again
          </button>
          <SkipNavButton onClick={handleSkipNav} />
        </div>
      )}

      {/* Active GPS / waiting states */}
      {granted && (gpsStatus === "waiting" || gpsStatus === "active") && (
        <>
          {find?.locations && (
            <div className="mb-4">
              <NavigateMap
                targetLat={find.locations.latitude}
                targetLng={find.locations.longitude}
                radiusMeters={find.locations.radius_meters || 50}
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
          <ClueHintPanel hints={hints} className="mb-3 text-left" />
          {hints.canRequestClueHint && (
            <button onClick={hints.requestClueHint} className={`${SECONDARY} mb-2 w-full`}>
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
  );
}
