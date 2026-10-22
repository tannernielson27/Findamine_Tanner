"use client";

import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import type { StartOptions } from "@/lib/play/play-types";

const PRIMARY =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY =
  "flex min-h-12 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-40";

export function PlayLoading() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div className="fm-shimmer space-y-4">
        <div className="h-4 bg-themed-border rounded w-1/3" />
        <div className="h-2 bg-themed-border rounded" />
        <div className="h-64 bg-themed-border/60 rounded-xl" />
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
    <main className="mx-auto max-w-2xl px-4 py-12">
      <form
        className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] p-5 sm:p-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmedCodename) onStart({ codename: trimmedCodename });
        }}
      >
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text mb-2">Choose your explorer name</h1>
        <p className="text-base text-themed-muted mb-4">
          This hunt shows players by an explorer name instead of their real name. Pick yours to start.
        </p>
        <label htmlFor="explorer-name" className="block text-sm font-semibold text-themed-text mb-1">
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
          className="min-h-12 w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text placeholder:text-themed-muted focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand mb-3"
        />
        {error && (
          <p id="explorer-name-error" role="alert" className="text-base text-error mb-3">{error}</p>
        )}
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={!trimmedCodename} className={`${PRIMARY} sm:flex-1`}>
            Start Hunt
          </button>
          <button type="button" onClick={() => onStart({ assign_codename: true })} className={`${SECONDARY} sm:flex-1`}>
            Pick one for me
          </button>
        </div>
      </form>
    </main>
  );
}

interface PlayLoadErrorProps {
  message: string;
  onRetry: () => void;
}

export function PlayLoadError({ message, onRetry }: PlayLoadErrorProps) {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <div role="alert" className="bg-surface rounded-xl border border-themed-border shadow-[var(--shadow-card)] px-5 py-8 text-center sm:px-8">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-bold text-themed-text mb-2">We couldn&apos;t load this hunt</h1>
        <p className="text-base text-themed-muted mb-6">{message}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button onClick={onRetry} className={`${PRIMARY} sm:w-auto`}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Try Again
          </button>
          <button onClick={() => router.push("/browse")} className={`${SECONDARY} w-full px-5 sm:w-auto`}>
            Back to Browse
          </button>
        </div>
      </div>
    </main>
  );
}

export function PlayEmpty() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 text-center text-base text-themed-muted">
      This hunt has no stops yet.
    </main>
  );
}
