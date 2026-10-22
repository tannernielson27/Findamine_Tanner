"use client";

import { Camera } from "lucide-react";
import { PhotoPicker } from "@/components/native/photo-picker";

interface CaptureStepProps {
  uploading: boolean;
  onFile: (file: File) => Promise<void>;
  onSkip: () => void;
}

/** Optional geo-selfie after a completed stop. */
export function CaptureStep({ uploading, onFile, onSkip }: CaptureStepProps) {
  return (
    <div className="text-center">
      <h2 className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text mb-2">Geo-Selfie!</h2>
      <p className="text-base text-themed-muted mb-6">
        Take a photo of yourself at this location to remember your adventure!
      </p>

      {/* Browser file input on the web; native camera (after the camera primer) in the iOS app. */}
      <PhotoPicker
        disabled={uploading}
        className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 mb-2 ${uploading ? "cursor-wait opacity-50" : "cursor-pointer"}`}
        onFile={onFile}
      >
        <Camera className="h-5 w-5" aria-hidden="true" />
        <span aria-live="polite">{uploading ? "Uploading photo..." : "Take Photo"}</span>
      </PhotoPicker>

      <div>
        <button onClick={onSkip} disabled={uploading} className="disabled:opacity-50inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-link underline-offset-2 transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 underline">
          Skip photo
        </button>
      </div>
    </div>
  );
}
