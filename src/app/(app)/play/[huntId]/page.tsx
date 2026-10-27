"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { PrivacyNoticeToast } from "@/components/play/privacy-notice-toast";
import { SafetyNotice, useSafetyAcknowledgement } from "@/components/play/safety-notice";
import { CodenameForm, PlayEmpty, PlayLoadError, PlayLoading } from "@/components/play/play-states";
import { HuntSummary } from "@/components/play/hunt-summary";
import { PlayScreen } from "@/components/play/play-screen";
import { useCelebrationState } from "@/lib/play/use-celebration-state";
import { usePlaySession } from "@/lib/play/use-play-session";
import { useStopFlow } from "@/lib/play/use-stop-flow";

// Confetti + framer-motion presence only matter once a stop is solved, so they
// load as their own chunk the first time a celebration is requested.
const Celebration = dynamic(() => import("@/components/ui/celebration").then((mod) => mod.Celebration), {
  ssr: false,
});

export default function PlayPage() {
  const { huntId } = useParams();
  const huntIdString = typeof huntId === "string" ? huntId : undefined;
  const celebration = useCelebrationState();
  const session = usePlaySession(huntId, celebration);
  const flow = useStopFlow(huntId, session, celebration);
  // Play-safely notice before the player's first hunt (App Store 1.4.5).
  const safetyAck = useSafetyAcknowledgement();
  const [codenameInput, setCodenameInput] = useState("");
  // Stay mounted after the first celebration so it can animate out.
  const [celebrationRequested, setCelebrationRequested] = useState(false);
  if (celebration.show && !celebrationRequested) setCelebrationRequested(true);

  if (session.loading) return <PlayLoading />;

  if (session.needsCodename) {
    return (
      <CodenameForm
        value={codenameInput}
        onChange={setCodenameInput}
        error={session.codenameError}
        onStart={(options) => session.loadHunt(options)}
      />
    );
  }

  if (session.loadError) {
    return <PlayLoadError message={session.loadError} onRetry={() => session.loadHunt()} />;
  }

  if (session.finds.length === 0 && !session.huntComplete) return <PlayEmpty />;

  const celebrationOverlay = celebrationRequested ? (
    <Celebration
      show={celebration.show}
      message={celebration.message}
      subMessage={celebration.sub}
      intensity={celebration.intensity}
      onComplete={celebration.close}
    />
  ) : null;

  if (session.huntComplete) {
    return (
      <main className="fixed inset-0 z-[51] overflow-hidden bg-juniper-deep">
        {celebrationOverlay}
        <HuntSummary summary={session.huntSummary} totalStops={session.finds.length} />
      </main>
    );
  }

  return (
    <PlayScreen
      huntId={huntIdString}
      session={session}
      flow={flow}
      overlays={
        <>
          {celebrationOverlay}
          {/* Same trigger, copy and events as before (storyline S6); its
              bottom position is unchanged, and the results screen keeps its
              buttons clear of it. */}
          {flow.privacyNotice && (
            <PrivacyNoticeToast key={flow.privacyNotice.id} notice={flow.privacyNotice} onClose={flow.closePrivacyNotice} />
          )}
          {safetyAck.status === "needed" && <SafetyNotice onAcknowledge={safetyAck.acknowledge} />}
        </>
      }
    />
  );
}
