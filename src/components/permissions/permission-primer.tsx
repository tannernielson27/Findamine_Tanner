"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MapPin, Mic, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { dialog } from "@/lib/motion";
import {
  PRIMER_COPY,
  decidePrimer,
  deniedMessage,
  deniedTitle,
  detectPlatform,
  hasSeenPrimer,
  markPrimerSeen,
  queryPermission,
  type AppPlatform,
  type PermissionKind,
} from "@/lib/permissions/primer";

const ICONS: Record<PermissionKind, LucideIcon> = {
  location: MapPin,
  microphone: Mic,
};

const PRIMARY_BUTTON =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";
const SECONDARY_BUTTON =
  "flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-base font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2";

const noopSubscribe = () => () => {};
const serverPlatform = (): AppPlatform => "web";

/** Current platform; "web" on the server and during hydration. */
function usePlatform(): AppPlatform {
  return useSyncExternalStore(noopSubscribe, () => detectPlatform(), serverPlatform);
}

/* ─── Denied notice ───────────────────────────────────────────── */

interface PermissionDeniedNoticeProps {
  kind: PermissionKind;
  /** Fallback actions, e.g. "Skip to Challenge". */
  children?: ReactNode;
}

/**
 * Shown when a permission is off. Tells the player how to turn it back on in
 * their platform's words (iOS Settings, Android app settings, or the
 * browser's site settings) and offers whatever fallback the caller has.
 */
export function PermissionDeniedNotice({ kind, children }: PermissionDeniedNoticeProps) {
  const platform = usePlatform();
  return (
    <div role="alert" className="rounded-xl border border-error/30 bg-error/10 p-4 mb-4 text-left">
      <p className="text-base font-semibold text-error mb-1">{deniedTitle(kind)}</p>
      <p className="text-base text-themed-text">{deniedMessage(kind, platform)}</p>
      {children && <div className="mt-3 flex flex-col gap-2">{children}</div>}
    </div>
  );
}

/* ─── Primer ──────────────────────────────────────────────────── */

interface PermissionPrimerProps {
  kind: PermissionKind;
  /**
   * Runs the real permission request. Called when the player taps Continue
   * (so the request keeps the user gesture), or straight away if the
   * permission is already granted.
   */
  onContinue: () => void;
  /** The player chose "Not now". */
  onDismiss: () => void;
  /** Fallback actions shown if the permission is already denied. */
  deniedActions?: ReactNode;
}

type PrimerView = "checking" | "show" | "denied";

/**
 * Explains why Findamine needs a permission before the system prompt appears
 * (App Store guideline 5.1.1 / HIG). Skips itself when the permission is
 * already granted, and goes straight to the "turn it on in Settings" notice
 * when it's already denied, since the OS won't ask again.
 */
export function PermissionPrimer({ kind, onContinue, onDismiss, deniedActions }: PermissionPrimerProps) {
  const [view, setView] = useState<PrimerView>("checking");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const onContinueRef = useRef(onContinue);
  const titleId = useId();
  const reasonId = useId();
  const copy = PRIMER_COPY[kind];
  const Icon = ICONS[kind];

  useEffect(() => {
    onContinueRef.current = onContinue;
  }, [onContinue]);

  useEffect(() => {
    let cancelled = false;
    void queryPermission(kind).then((status) => {
      if (cancelled) return;
      const decision = decidePrimer(status, hasSeenPrimer(kind));
      if (decision === "skip") onContinueRef.current();
      else setView(decision);
    });
    return () => {
      cancelled = true;
    };
  }, [kind]);

  // Move focus to the explanation so screen-reader and keyboard users land on it.
  useEffect(() => {
    if (view === "show") headingRef.current?.focus();
  }, [view]);

  if (view === "checking") return null;

  if (view === "denied") {
    return <PermissionDeniedNotice kind={kind}>{deniedActions}</PermissionDeniedNotice>;
  }

  function handleContinue() {
    markPrimerSeen(kind);
    onContinue();
  }

  return (
    <motion.section
      variants={dialog}
      initial="hidden"
      animate="visible"
      aria-labelledby={titleId}
      aria-describedby={reasonId}
      className="rounded-xl border border-themed-border bg-surface p-5 mb-4 text-center shadow-sm"
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-link/10">
        <Icon className="h-6 w-6 text-link" aria-hidden="true" />
      </div>
      <h3
        id={titleId}
        ref={headingRef}
        tabIndex={-1}
        className="font-[family-name:var(--font-display)] text-lg font-semibold text-themed-text mb-2 focus:outline-none"
      >
        {copy.title}
      </h3>
      <p id={reasonId} className="text-base text-themed-muted mb-4">
        {copy.reason}
      </p>
      <div className="flex flex-col gap-2">
        <button type="button" onClick={handleContinue} className={PRIMARY_BUTTON}>
          {copy.continueLabel}
        </button>
        <button type="button" onClick={onDismiss} className={SECONDARY_BUTTON}>
          {copy.dismissLabel}
        </button>
      </div>
    </motion.section>
  );
}
