"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ImageIcon } from "lucide-react";
import { PermissionPrimer } from "@/components/permissions/permission-primer";
import { isNativeApp } from "@/lib/native/platform";
import { pickNativePhoto, PhotoError, type PhotoSource } from "@/lib/native/camera";

const LIBRARY_BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-link transition-colors hover:text-link-dark hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";

const noopSubscribe = () => () => {};

/** True inside the iOS app; false on the server and during hydration. */
function useIsNative(): boolean {
  return useSyncExternalStore(noopSubscribe, () => isNativeApp(), () => false);
}

interface PhotoPickerProps {
  /** Receives the picked image. Errors it throws are the caller's to show. */
  onFile: (file: File) => void | Promise<void>;
  disabled?: boolean;
  /** Classes for the tappable area (the <label> on web, the <button> in the app). */
  className: string;
  /** What the tappable area shows, e.g. an icon and "Take Photo". */
  children: ReactNode;
}

/**
 * "Take a photo" control.
 *
 * Web: the existing `<input type="file" accept="image/*" capture>` (browser
 * camera / picker), unchanged.
 * iOS app: the native camera, after the camera primer when iOS hasn't asked
 * yet, plus a "Choose from library" option (the system photo picker, which
 * needs no permission).
 */
export function PhotoPicker({ onFile, disabled, className, children }: PhotoPickerProps) {
  const native = useIsNative();
  const [showPrimer, setShowPrimer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!native) {
    return (
      <label className={className}>
        {children}
        <input
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={disabled}
          onChange={async (e) => {
            const input = e.target;
            const file = input.files?.[0];
            // Clear now so the same photo can be picked again after a failure.
            input.value = "";
            if (file) await onFile(file);
          }}
        />
      </label>
    );
  }

  async function pick(source: PhotoSource) {
    setShowPrimer(false);
    setProblem(null);
    setBusy(true);
    let file: File;
    try {
      file = await pickNativePhoto(source);
    } catch (err) {
      setBusy(false);
      const kind = err instanceof PhotoError ? err.kind : "failed";
      if (kind === "denied") {
        setProblem(
          source === "camera"
            ? "Camera is off for Findamine. Turn it on in Settings > Findamine > Camera, or choose a photo from your library."
            : "Findamine couldn't open your photos. Check Settings > Findamine > Photos, then try again."
        );
      } else if (kind === "failed") {
        setProblem("We couldn't get that photo. Please try again.");
      }
      // "cancelled": the player backed out; nothing to say.
      return;
    }
    try {
      // Upload errors are shown by the caller, as on the web.
      await onFile(file);
    } finally {
      setBusy(false);
    }
  }

  if (showPrimer) {
    return (
      <PermissionPrimer
        kind="camera"
        onContinue={() => void pick("camera")}
        deniedActions={
          <button type="button" onClick={() => void pick("library")} className={LIBRARY_BUTTON}>
            <ImageIcon className="h-4 w-4" aria-hidden="true" />
            Choose from library instead
          </button>
        }
      />
    );
  }

  return (
    <div>
      <button
        type="button"
        className={`${className} w-full`}
        disabled={disabled || busy}
        onClick={() => setShowPrimer(true)}
      >
        {children}
      </button>
      <div className="mt-1 text-center">
        <button
          type="button"
          className={LIBRARY_BUTTON}
          disabled={disabled || busy}
          onClick={() => void pick("library")}
        >
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
          Choose from library
        </button>
      </div>
      {problem && (
        <p role="alert" className="mt-2 text-sm text-error">
          {problem}
        </p>
      )}
    </div>
  );
}
