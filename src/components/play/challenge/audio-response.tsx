"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, RotateCcw, Square } from "lucide-react";
import { PermissionDeniedNotice, PermissionPrimer } from "@/components/permissions/permission-primer";
import { MAX_AUDIO_SECONDS, audioExtension } from "@/lib/play/audio-answer";
import { Button } from "@/components/ui/button";
import { fetchMe } from "@/lib/hooks/use-me";
import { QuestionText, SubmitButton, TEXT_ACTION_CLASS } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

// ── Audio Response ───────────────────────────────────

type AudioSaveState = "idle" | "saving" | "saved" | "error";

/** Formats MediaRecorder can produce, best first. Safari/iOS only does mp4. */
const PREFERRED_AUDIO_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"];

function pickRecorderType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return PREFERRED_AUDIO_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** True/false from /auth/me, or null when it can't be told. */
async function isChildAccount(): Promise<boolean | null> {
  try {
    const data = await fetchMe();
    if (!data) return null;
    return data.user?.role === "child";
  } catch {
    return null;
  }
}

/**
 * Store the recording and return the answer string to submit. A child's
 * recording never leaves the device (COPPA); if the role can't be read the
 * recording is sent and the server discards it for a child.
 */
async function saveSpokenAnswer(
  huntId: string,
  findId: string,
  blob: Blob,
  seconds: number
): Promise<{ answer: string; localOnly: boolean }> {
  const form = new FormData();
  form.append("find_id", findId);
  form.append("duration_seconds", String(seconds));
  if ((await isChildAccount()) !== true) {
    form.append("file", blob, `answer.${audioExtension(blob.type)}`);
  }
  const res = await fetch(`/api/v1/play/${huntId}/audio`, { method: "POST", body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok || typeof data?.answer !== "string") {
    throw new Error(data?.error || "We couldn't save your recording. Check your connection and try again.");
  }
  return { answer: data.answer, localOnly: !!data.local_only };
}

export function AudioResponse({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  huntId,
  findId,
  showQuestion = true,
}: ChallengeFieldProps & { huntId?: string; findId?: string }) {
  const question = questionOf(content, "Record your spoken answer.");
  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  // "denied": the player or the OS said no; "failed": no usable microphone.
  const [micError, setMicError] = useState<"denied" | "failed" | null>(null);
  // Show the microphone primer before the first getUserMedia call.
  const [showPrimer, setShowPrimer] = useState(false);
  const [saveState, setSaveState] = useState<AudioSaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOnDevice, setSavedOnDevice] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopButtonRef = useRef<HTMLButtonElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const startedAtRef = useRef(0);
  const secondsRef = useRef(0);
  // Bumped on every save or reset so a slow, superseded save is ignored.
  const saveSeqRef = useRef(0);

  // The primer that held focus is gone once recording starts: hand focus to
  // the Stop button so keyboard and screen-reader users aren't left on <body>.
  useEffect(() => {
    if (recording) stopButtonRef.current?.focus();
  }, [recording]);

  const saveRecording = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const seq = ++saveSeqRef.current;
    setSaveState("saving");
    setSaveError(null);
    try {
      if (!huntId || !findId) throw new Error("We couldn't save your recording. Reload the page and try again.");
      const saved = await saveSpokenAnswer(huntId, findId, blob, secondsRef.current);
      if (seq !== saveSeqRef.current) return;
      setSavedOnDevice(saved.localOnly);
      onAnswerChange(saved.answer);
      setSaveState("saved");
    } catch (err) {
      if (seq !== saveSeqRef.current) return;
      setSaveError(err instanceof Error ? err.message : "We couldn't save your recording.");
      setSaveState("error");
    }
  };

  const startRecording = async () => {
    setShowPrimer(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("failed");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = pickRecorderType();
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        // The real container: audio/mp4 on iOS Safari/WKWebView, audio/webm on Chrome.
        const type = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        secondsRef.current = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        setAudioUrl(URL.createObjectURL(blob));
        void saveRecording();
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      startedAtRef.current = Date.now();
      saveSeqRef.current++;
      blobRef.current = null;
      setRecording(true);
      setDuration(0);
      setAudioUrl(null);
      setSaveState("idle");
      setSaveError(null);
      onAnswerChange("");

      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setMicError(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "failed");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  // Recordings are capped so the upload stays small; stop at the limit.
  useEffect(() => {
    if (recording && duration >= MAX_AUDIO_SECONDS) stopRecording();
  }, [recording, duration]);

  const resetRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    saveSeqRef.current++;
    blobRef.current = null;
    setAudioUrl(null);
    setDuration(0);
    setSaveState("idle");
    setSaveError(null);
    onAnswerChange("");
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  return (
    <div className="flex flex-col gap-4">
      <QuestionText show={showQuestion}>{question}</QuestionText>

      {micError === "denied" && <PermissionDeniedNotice kind="microphone" />}
      {micError === "failed" && (
        <div className="rounded-2xl border border-error/30 bg-error/10 p-3" role="alert">
          <p className="text-base text-ink">
            We couldn&apos;t start a microphone on this device. Check that one is connected and not in use by another app.
          </p>
        </div>
      )}

      {showPrimer ? (
        <PermissionPrimer kind="microphone" onContinue={startRecording} />
      ) : (
        <div className="rounded-2xl border border-themed-border bg-white p-4 text-center">
          {recording ? (
            <div>
              <div className="mb-3 flex items-center justify-center gap-2">
                <span className="h-3 w-3 rounded-full bg-error motion-safe:animate-pulse" aria-hidden="true" />
                <span className="text-lg font-bold text-ink">Recording</span>
                <span className="text-lg tabular-nums text-ink">
                  {formatTime(duration)} / {formatTime(MAX_AUDIO_SECONDS)}
                </span>
              </div>
              <Button ref={stopButtonRef} variant="ink" size="lg" block onClick={stopRecording}>
                <Square className="h-4 w-4" fill="currentColor" aria-hidden="true" />
                Stop Recording
              </Button>
            </div>
          ) : audioUrl ? (
            <div>
              <audio src={audioUrl} controls className="mx-auto mb-3 w-full max-w-xs" />
              <p className="mb-2 text-base tabular-nums text-ink">Duration: {formatTime(secondsRef.current || duration)}</p>
              {saveState === "saving" && (
                <p role="status" className="mb-2 text-base text-ink">Saving your recording...</p>
              )}
              {saveState === "saved" && (
                <p role="status" className="mb-2 text-base text-ink">
                  {savedOnDevice ? "Kept on this device only, for your privacy." : "Recording saved."}
                </p>
              )}
              {saveState === "error" && (
                <div role="alert" className="mb-2 rounded-2xl border border-error/30 bg-error/10 p-3 text-left">
                  <p className="mb-2 text-base text-ink">{saveError}</p>
                  <button type="button" onClick={() => void saveRecording()} disabled={disabled} className={TEXT_ACTION_CLASS}>
                    Try again
                  </button>
                </div>
              )}
              <button type="button" onClick={resetRecording} className={TEXT_ACTION_CLASS}>
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Record again
              </button>
            </div>
          ) : (
            <div>
              <Mic className="mx-auto mb-2 h-8 w-8 text-link" aria-hidden="true" />
              <Button
                variant="secondary"
                size="lg"
                block
                onClick={() => {
                  setMicError(null);
                  setShowPrimer(true);
                }}
                disabled={disabled || micError === "denied"}
              >
                Start Recording
              </Button>
              <p className="mt-2 text-base text-ink">Tap to record your spoken answer (up to {MAX_AUDIO_SECONDS / 60} minutes)</p>
            </div>
          )}
        </div>
      )}

      <SubmitButton
        ready={!!audioUrl && saveState === "saved" && !!answer}
        disabled={disabled}
        onClick={onSubmit}
        label="Submit recording"
        waitingLabel={saveState === "saving" ? "Saving your recording…" : "Record your answer"}
      />
    </div>
  );
}
