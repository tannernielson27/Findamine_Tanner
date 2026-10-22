"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Celebration } from "@/components/ui/celebration";
import { PrivacyNoticeToast } from "@/components/play/privacy-notice-toast";
import { SafetyNotice, useSafetyAcknowledgement } from "@/components/play/safety-notice";
import { CodenameForm, PlayEmpty, PlayLoadError, PlayLoading } from "@/components/play/play-states";
import { HuntSummary } from "@/components/play/hunt-summary";
import { ActivePlay } from "@/components/play/active-play";
import { useCelebrationState } from "@/lib/play/use-celebration-state";
import { usePlaySession } from "@/lib/play/use-play-session";
import { useStopFlow } from "@/lib/play/use-stop-flow";

export default function PlayPage() {
  const { huntId } = useParams();
  const huntIdString = typeof huntId === "string" ? huntId : undefined;
  const celebration = useCelebrationState();
  const session = usePlaySession(huntId, celebration);
  const flow = useStopFlow(huntId, session, celebration);
  // Play-safely notice before the player's first hunt (App Store 1.4.5).
  const safetyAck = useSafetyAcknowledgement();
  const [codenameInput, setCodenameInput] = useState("");

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

  const celebrationOverlay = (
    <Celebration
      show={celebration.show}
      message={celebration.message}
      subMessage={celebration.sub}
      intensity={celebration.intensity}
      onComplete={celebration.close}
    />
  );

  if (session.huntComplete) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-6">
        {celebrationOverlay}
        <HuntSummary summary={session.huntSummary} totalStops={session.finds.length} />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {celebrationOverlay}

      {flow.privacyNotice && (
        <PrivacyNoticeToast
          key={flow.privacyNotice.id}
          notice={flow.privacyNotice}
          onClose={flow.closePrivacyNotice}
        />
      )}

      {safetyAck.status === "needed" && <SafetyNotice onAcknowledge={safetyAck.acknowledge} />}

      <ActivePlay huntId={huntIdString} session={session} flow={flow} />
    </main>
  );
}
