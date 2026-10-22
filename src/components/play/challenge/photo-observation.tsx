"use client";

/* eslint-disable @next/next/no-img-element -- local data: URL preview */
import { useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { PhotoPicker } from "@/components/native/photo-picker";
import type { ChallengeFieldProps } from "./types";

export function PhotoObservation({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
}: ChallengeFieldProps) {
  const question = (content.question as string) || (content.text as string) || "Take a photo and describe what you observe.";
  const [preview, setPreview] = useState<string | null>(null);
  const [observation, setObservation] = useState(answer);

  const handlePhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      setPreview(base64);
      // Combine photo reference + observation text as the answer
      onAnswerChange(`[photo:captured] ${observation}`);
    };
    reader.readAsDataURL(file);
  };

  const handleObservationChange = (text: string) => {
    setObservation(text);
    onAnswerChange(preview ? `[photo:captured] ${text}` : text);
  };

  return (
    <div>
      <p className="text-base text-themed-text mb-3">{question}</p>

      {/* Photo capture */}
      {preview ? (
        <div className="mb-3 text-center">
          <img src={preview} alt="Your observation" className="rounded-xl max-h-48 mx-auto mb-2" />
          <button
            onClick={() => { setPreview(null); onAnswerChange(observation); }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-link transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retake photo
          </button>
        </div>
      ) : (
        <div className="mb-3">
          {/* Browser file input on the web; native camera (after the camera primer) in the iOS app. */}
          <PhotoPicker
            onFile={handlePhoto}
            disabled={disabled}
            className="flex min-h-32 items-center justify-center rounded-xl border-2 border-dashed border-themed-border bg-surface p-6 cursor-pointer transition-colors hover:border-link hover:bg-link/5 focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            <div className="text-center">
              <Camera className="mx-auto mb-2 h-8 w-8 text-link" aria-hidden="true" />
              <p className="text-base font-semibold text-themed-text">Tap to take a photo</p>
            </div>
          </PhotoPicker>
        </div>
      )}

      {/* Observation text */}
      <textarea
        value={observation}
        onChange={(e) => handleObservationChange(e.target.value)}
        placeholder="Describe what you observe..."
        rows={3}
        disabled={disabled}
        aria-label="Describe what you observe"
        className="w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 mb-3 resize-y"
      />

      <button
        onClick={onSubmit}
        disabled={!observation.trim() || disabled}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-brand px-4 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
      >
        Submit Observation
      </button>
    </div>
  );
}
