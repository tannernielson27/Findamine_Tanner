"use client";

import { useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PermissionPrimer } from "@/components/permissions/permission-primer";
import { StopSafetyNote } from "@/components/play/safety-tips";
import { ClueCard } from "@/components/play/clue-card";
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
 *   navigate → "I'm here"         (handleSkipNav: manual arrival → challenge)
 * GPS arrival still opens the challenge on its own (useGeoTracking).
 */
export function ThumbZone({ find, flow }: ThumbZoneProps) {
  const { step, locationConsent, setLocationConsent, handleSkipNav, handleClueRead, hints } = flow;
  const [checkingIn, setCheckingIn] = useState(false);
  const navigating = step === "navigate";
  const primerUp = navigating && locationConsent === "pending";

  async function checkIn() {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      await handleSkipNav();
    } finally {
      setCheckingIn(false);
    }
  }

  const checkInButton = (
    <Button size="xl" block elevated onClick={() => void checkIn()} disabled={checkingIn}>
      <MapPin className="h-[22px] w-[22px]" strokeWidth={2.4} aria-hidden="true" />
      {checkingIn ? "Checking in…" : "I'm here"}
    </Button>
  );

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
              deniedActions={checkInButton}
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
      {navigating && !primerUp && checkInButton}
    </div>
  );
}
