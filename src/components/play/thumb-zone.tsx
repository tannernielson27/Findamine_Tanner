"use client";

import { useState } from "react";
import { Camera, MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionPrimer } from "@/components/permissions/permission-primer";
import { StopSafetyNote } from "@/components/play/safety-tips";
import { ClueCard } from "@/components/play/clue-card";
import { PhotoPicker } from "@/components/native/photo-picker";
import { AiPhotoCheckGate } from "@/components/play/ai-photo-check-gate";
import { PHOTO_CHECK_IN_COPY } from "@/lib/play/check-in";
import type { Find } from "@/lib/play/play-types";
import type { StopFlow } from "@/lib/play/use-stop-flow";

interface ThumbZoneProps {
  find: Find | undefined;
  flow: StopFlow;
}

/**
 * Bottom of the map screen, where the thumb rests: location primer (first
 * time only), the creator's safety note, the ink clue card, and one primary
 * action that maps onto the existing step machine:
 *   clue     → "Start navigating" (handleClueRead: clue → navigate)
 *   navigate → "I'm here"         (handleCheckIn: fresh GPS fix, checked by the server)
 * GPS arrival still opens the challenge on its own (useGeoTracking). When GPS
 * can't confirm the player, a photo check-in card takes the button's place.
 */
export function ThumbZone({ find, flow }: ThumbZoneProps) {
  const { step, locationConsent, setLocationConsent, handleCheckIn, handleClueRead, hints, photoCheckIn } = flow;
  const [checkingIn, setCheckingIn] = useState(false);
  const navigating = step === "navigate";
  const primerUp = navigating && locationConsent === "pending";

  async function busy(action: () => Promise<void>) {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      await action();
    } finally {
      setCheckingIn(false);
    }
  }
  const checkIn = () => busy(handleCheckIn);

  const checkInButton = (
    <Button size="xl" block elevated onClick={() => void checkIn()} disabled={checkingIn}>
      <MapPin className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden="true" />
      {checkingIn ? "Checking in…" : "I'm here"}
    </Button>
  );

  const photoCard = photoCheckIn ? (
    <section aria-label="Photo check-in" className="flex flex-col gap-2 rounded-[20px] bg-white p-4 shadow-lg">
      <p className="text-sm text-ink">{PHOTO_CHECK_IN_COPY[photoCheckIn]}</p>
      <AiPhotoCheckGate>
        <PhotoPicker
          cameraOnly
          disabled={checkingIn}
          onFile={(file) => busy(() => flow.handlePhotoCheckIn(file))}
          className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-4 font-semibold text-white transition-colors hover:bg-brand-dark focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <Camera className="h-5 w-5" aria-hidden="true" />
          {checkingIn ? "Checking in…" : "Take a check-in photo"}
        </PhotoPicker>
      </AiPhotoCheckGate>
      <button
        type="button"
        onClick={flow.cancelPhotoCheckIn}
        disabled={checkingIn}
        className="min-h-11 text-sm font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
      >
        Try my location again
      </button>
    </section>
  ) : null;
  // "I'm here", or the photo check-in once GPS couldn't confirm the player.
  const checkInControl = photoCard ?? checkInButton;

  return (
    <div className="absolute inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] z-10 flex flex-col gap-3">
      <div className="flex max-h-[46dvh] flex-col gap-3 overflow-y-auto overscroll-contain rounded-[20px]">
        {/* Explain location before the OS prompt (App Store 5.1.1). Continue
            always leads to the OS prompt; a "no" there shows the denied banner. */}
        {primerUp && (
          <div className="[&>section]:mb-0 [&>div]:mb-0">
            <PermissionPrimer
              kind="location"
              onContinue={() => setLocationConsent("granted")}
              deniedActions={checkInControl}
            />
          </div>
        )}
        {navigating && find?.locations?.safety_notes?.trim() && (
          <div className="rounded-2xl bg-white [&>div]:mb-0">
            <StopSafetyNote notes={find.locations.safety_notes} />
          </div>
        )}
        <ClueCard
          clue={find?.clue_text ?? null}
          placeName={find?.locations?.name ?? null}
          hints={hints}
          showSafetyReminder={navigating}
        />
      </div>

      {step === "clue" && (
        <Button size="xl" block elevated onClick={handleClueRead}>
          <Navigation className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden="true" />
          Start navigating
        </Button>
      )}
      {/* Hidden while the primer is up, so the primer's only way on is Continue. */}
      {navigating && !primerUp && checkInControl}
    </div>
  );
}
