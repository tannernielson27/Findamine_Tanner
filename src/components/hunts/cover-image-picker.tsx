"use client";

/**
 * Choose, replace or remove a hunt's cover photo. Talks to
 * POST/DELETE /api/v1/hunts/[id]/cover; with no photo it previews the
 * generated contour art players will see instead.
 */
import { useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { TopoCover, toneForHunt } from "@/components/ui/topo-cover";
import { COVER_MAX_BYTES } from "@/lib/hunts/cover-image";

/** What the server said after a change. `message` explains a return to review. */
export interface CoverChange {
  coverImageUrl: string | null;
  message: string | null;
}

interface CoverImagePickerProps {
  huntId: string;
  huntTitle: string;
  coverImageUrl: string | null;
  disabled?: boolean;
  onChange?: (change: CoverChange) => void;
}

/**
 * HEIC is accepted by the server but left out here: iOS converts photos to
 * JPEG when HEIC isn't listed, and browsers other than Safari can't show HEIC.
 */
const ACCEPT = "image/jpeg,image/png,image/webp";

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === "string" ? body.error : `Request failed (error ${res.status})`;
}

function parseChange(body: unknown): CoverChange {
  const data = (body as { data?: { cover_image_url?: unknown; message?: unknown } } | null)?.data;
  return {
    coverImageUrl: typeof data?.cover_image_url === "string" ? data.cover_image_url : null,
    message: typeof data?.message === "string" ? data.message : null,
  };
}

export function CoverImagePicker({ huntId, huntTitle, coverImageUrl, disabled, onChange }: CoverImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();
  const [url, setUrl] = useState<string | null>(coverImageUrl);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState("");

  const run = async (kind: "upload" | "remove", request: () => Promise<Response>) => {
    setBusy(kind);
    setError("");
    try {
      const res = await request();
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const change = parseChange(await res.json().catch(() => null));
      setUrl(change.coverImageUrl);
      onChange?.(change);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > COVER_MAX_BYTES) {
      setError("That photo is too large. The limit is 5 MB.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    void run("upload", () => fetch(`/api/v1/hunts/${huntId}/cover`, { method: "POST", body: form }));
  };

  const handleRemove = () => {
    if (!confirm("Remove the cover photo? Players will see the generated art instead.")) return;
    void run("remove", () => fetch(`/api/v1/hunts/${huntId}/cover`, { method: "DELETE" }));
  };

  const locked = disabled || busy !== null;

  return (
    <section aria-labelledby={`${inputId}-heading`} className="mb-4 rounded-lg border border-gray-200 p-3">
      <h2 id={`${inputId}-heading`} className="text-sm font-medium text-gray-700">
        Cover photo
      </h2>
      <TopoCover
        tone={toneForHunt(huntId, huntTitle)}
        imageUrl={url}
        alt={`Cover photo for ${huntTitle}`}
        className="mt-2 aspect-video w-full rounded-md"
      >
        {!url && (
          <span className="absolute bottom-2 left-2 rounded bg-black/50 px-2 py-0.5 text-xs text-white">
            No photo yet: players see this art
          </span>
        )}
      </TopoCover>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        aria-label={url ? "Replace cover photo" : "Choose cover photo"}
        aria-describedby={error ? errorId : undefined}
        disabled={locked}
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={locked} onClick={() => inputRef.current?.click()}>
          {busy === "upload" ? "Uploading..." : url ? "Replace photo" : "Choose photo"}
        </Button>
        {url && (
          <Button variant="ghost" disabled={locked} onClick={handleRemove}>
            {busy === "remove" ? "Removing..." : "Remove photo"}
          </Button>
        )}
      </div>
      <p className="mt-1 text-xs text-gray-500">JPEG, PNG or WebP, up to 5 MB. A wide (16:9) photo works best.</p>
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}
