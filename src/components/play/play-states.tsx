"use client";

import type { ReactNode } from "react";
import { MapPinOff, RotateCcw } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/button";
import type { StartOptions } from "@/lib/play/play-types";

/** Full-screen ground for the pre-play states (no app chrome on /play). */
function PlayFrame({ children }: { children: ReactNode }) {
  return (
    <main className="fixed inset-0 z-[51] flex flex-col items-center justify-center overflow-y-auto bg-map-ground px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
      {children}
    </main>
  );
}

const CARD = "w-full max-w-md rounded-[24px] bg-white p-6 shadow-[0_8px_24px_rgb(28_36_48/0.16)]";

export function PlayLoading() {
  return (
    <main className="fixed inset-0 z-[51] bg-map-ground px-4 pt-[calc(12px+env(safe-area-inset-top))]" aria-busy="true">
      <p role="status" className="sr-only">Loading your hunt…</p>
      <div className="fm-shimmer flex flex-col gap-2.5" aria-hidden="true">
        <div className="flex gap-2.5">
          <div className="h-[52px] w-[52px] rounded-full bg-white/80" />
          <div className="h-[52px] flex-1 rounded-full bg-white/80" />
          <div className="h-[52px] w-[52px] rounded-full bg-white/80" />
        </div>
        <div className="h-[164px] rounded-[24px] bg-white/80" />
      </div>
      <div className="fm-shimmer absolute inset-x-4 bottom-[calc(16px+env(safe-area-inset-bottom))] flex flex-col gap-3" aria-hidden="true">
        <div className="h-24 rounded-[20px] bg-ink/15" />
        <div className="h-16 rounded-[20px] bg-white/80" />
      </div>
    </main>
  );
}

interface CodenameFormProps {
  /** Kept by the page so a taken name stays in the box after the retry. */
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  onStart: (options: StartOptions) => void;
}

export function CodenameForm({ value: codenameInput, onChange: setCodenameInput, error, onStart }: CodenameFormProps) {
  const trimmedCodename = codenameInput.trim();
  return (
    <PlayFrame>
      <form
        className={CARD}
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmedCodename) onStart({ codename: trimmedCodename });
        }}
      >
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-[26px] font-semibold leading-tight">Choose your explorer name</h1>
        <p className="mb-4 text-base">
          This hunt shows players by an explorer name instead of their real name. Pick yours to start.
        </p>
        <label htmlFor="explorer-name" className="mb-1 block text-base font-bold">
          Explorer name
        </label>
        <input
          id="explorer-name"
          type="text"
          value={codenameInput}
          onChange={(e) => setCodenameInput(e.target.value)}
          maxLength={40}
          autoComplete="off"
          aria-describedby={error ? "explorer-name-error" : undefined}
          aria-invalid={error ? true : undefined}
          className="mb-3 min-h-14 w-full rounded-2xl border-2 border-themed-border bg-white px-4 text-lg text-ink focus:border-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        />
        {error && (
          <p id="explorer-name-error" role="alert" className="mb-3 text-base font-semibold text-[#B42318]">{error}</p>
        )}
        <div className="flex flex-col gap-2">
          <Button type="submit" size="lg" block disabled={!trimmedCodename}>
            Start hunt
          </Button>
          <Button variant="secondary" size="lg" block onClick={() => onStart({ assign_codename: true })}>
            Pick one for me
          </Button>
        </div>
      </form>
    </PlayFrame>
  );
}

interface PlayLoadErrorProps {
  message: string;
  onRetry: () => void;
}

/** The start (or load) failed: say why, offer a retry. Never the "no stops" state. */
export function PlayLoadError({ message, onRetry }: PlayLoadErrorProps) {
  return (
    <PlayFrame>
      <div role="alert" className={`${CARD} text-center`}>
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-[26px] font-semibold leading-tight">We couldn&apos;t start this hunt</h1>
        <p className="mb-6 text-base">{message}</p>
        <div className="flex flex-col gap-2">
          <Button size="lg" block onClick={onRetry}>
            <RotateCcw className="h-5 w-5" aria-hidden="true" />
            Try again
          </Button>
          <ButtonLink href="/browse" variant="secondary" size="lg" block>
            Find another hunt
          </ButtonLink>
        </div>
      </div>
    </PlayFrame>
  );
}

/** The hunt loaded but has no stops (a creator problem, not a player one). */
export function PlayEmpty() {
  return (
    <PlayFrame>
      <div role="status" className={`${CARD} text-center`}>
        <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-sky-tint text-link">
          <MapPinOff className="h-7 w-7" aria-hidden="true" />
        </span>
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-[26px] font-semibold leading-tight">This hunt has no stops yet</h1>
        <p className="mb-6 text-base">Its creator hasn&apos;t added any stops, so there&apos;s nothing to play. Try another hunt for now.</p>
        <ButtonLink href="/browse" size="lg" block>
          Find another hunt
        </ButtonLink>
      </div>
    </PlayFrame>
  );
}
