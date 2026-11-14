"use client";

import { useCallback, useEffect, useState } from "react";
import { eventEnvelope, type EventEnvelope } from "@/lib/telemetry/envelope";
import { nativePlatform } from "@/lib/native/platform";

export type WaveStatus = "not_yet" | "open" | "done" | "not_assigned";

export interface StudyWave {
  wave: "T0" | "T1" | "MID" | "T2";
  title: string;
  minutes: number;
  status: WaveStatus;
  opens_at: string | null;
  url: string | null;
}

export type StudySurveysState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not_enrolled" }
  | { kind: "enrolled"; participantCode: string; waves: StudyWave[] };

/** The signed-in participant's Study ID and Qualtrics surveys. */
export function useStudySurveys() {
  const [state, setState] = useState<StudySurveysState>({ kind: "loading" });
  const [envelope, setEnvelope] = useState<EventEnvelope | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Resolved ahead of the tap, so the link can open synchronously in the
    // click handler (browsers block pop-ups opened after an await).
    void eventEnvelope().then((e) => {
      if (!cancelled) setEnvelope(e);
    });
    fetch("/api/v1/research/qualtrics")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { enrolled: boolean; participant_code?: string; waves?: StudyWave[] }) => {
        if (cancelled) return;
        setState(
          data.enrolled && data.participant_code
            ? { kind: "enrolled", participantCode: data.participant_code, waves: data.waves ?? [] }
            : { kind: "not_enrolled" }
        );
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((n) => n + 1);
  }, []);

  /** Open a wave's Qualtrics link (and log the launch). Must be called from a tap. */
  const openWave = useCallback(
    (wave: StudyWave) => {
      if (!wave.url) return;
      const url = new URL(wave.url);
      const platform = envelope?.platform ?? nativePlatform();
      url.searchParams.set("platform", platform);
      if (envelope?.app_version) url.searchParams.set("app_version", envelope.app_version);
      postAction(wave.wave, "launched", platform, envelope?.app_version ?? null);

      if (platform === "web") {
        const win = window.open(url.toString(), "_blank", "noopener,noreferrer");
        if (win) return;
      }
      // Inside the app wrapper, a link to another site opens in the phone's browser.
      window.location.href = url.toString();
    },
    [envelope]
  );

  /** Record that the participant says they finished a wave, then refresh. */
  const markDone = useCallback(
    async (wave: StudyWave): Promise<boolean> => {
      const ok = await postAction(
        wave.wave,
        "marked_done",
        envelope?.platform ?? nativePlatform(),
        envelope?.app_version ?? null
      );
      if (ok) reload();
      return ok;
    },
    [envelope, reload]
  );

  return { state, openWave, markDone, reload };
}

async function postAction(
  wave: StudyWave["wave"],
  action: "launched" | "marked_done",
  platform: string,
  appVersion: string | null
): Promise<boolean> {
  try {
    const res = await fetch("/api/v1/research/qualtrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wave, action, platform, app_version: appVersion }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}
