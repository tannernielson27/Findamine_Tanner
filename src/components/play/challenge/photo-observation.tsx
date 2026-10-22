"use client";

/* eslint-disable @next/next/no-img-element -- local data: URL preview */
import { useState } from "react";
import { Camera, RotateCcw } from "lucide-react";
import { PhotoPicker } from "@/components/native/photo-picker";
import { FIELD_CLASS, QuestionText, SubmitButton, TEXT_ACTION_CLASS } from "./parts";
import { questionOf, type ChallengeFieldProps } from "./types";

export function PhotoObservation({
  content,
  answer,
  onAnswerChange,
  onSubmit,
  disabled,
  showQuestion = true,
}: ChallengeFieldProps) {
  const question = questionOf(content, "Take a photo and describe what you observe.");
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
    <div className="flex flex-col gap-4">
      <QuestionText show={showQuestion}>{question}</QuestionText>

      {/* Photo capture */}
      {preview ? (
        <div className="text-center">
          <img src={preview} alt="Your observation" className="mx-auto mb-2 max-h-48 rounded-2xl" />
          <button
            type="button"
            onClick={() => { setPreview(null); onAnswerChange(observation); }}
            className={TEXT_ACTION_CLASS}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Retake photo
          </button>
        </div>
      ) : (
        // Browser file input on the web; native camera (after the camera primer) in the iOS app.
        <PhotoPicker
          onFile={handlePhoto}
          disabled={disabled}
          className="flex min-h-32 cursor-pointer items-center justify-center rounded-2xl border-2 border-dashed border-ink/30 bg-white p-6 transition-colors hover:border-link hover:bg-sky-tint focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <div className="text-center">
            <Camera className="mx-auto mb-2 h-8 w-8 text-link" aria-hidden="true" />
            <p className="text-lg font-bold text-ink">Tap to take a photo</p>
          </div>
        </PhotoPicker>
      )}

      {/* Observation text */}
      <textarea
        value={observation}
        onChange={(e) => handleObservationChange(e.target.value)}
        placeholder="Describe what you observe..."
        rows={3}
        disabled={disabled}
        aria-label="Describe what you observe"
        className={`${FIELD_CLASS} resize-y py-3`}
      />

      <SubmitButton
        ready={!!observation.trim()}
        disabled={disabled}
        onClick={onSubmit}
        label="Submit observation"
        waitingLabel="Describe what you see"
      />
    </div>
  );
}
