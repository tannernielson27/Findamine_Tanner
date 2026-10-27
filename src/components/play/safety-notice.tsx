"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { m } from "framer-motion";
import { backdrop, dialog } from "@/lib/motion";
import { fetchMe, invalidateMe } from "@/lib/hooks/use-me";
import {
  isSafetyAcknowledged,
  safetyAckMetadata,
  safetyAckStorageKey,
} from "@/lib/play/safety";
import { SafetyTipList } from "./safety-tips";

interface SafetyNoticeProps {
  onAcknowledge: () => void;
}

/**
 * Play-safely notice shown before a player's first hunt. Blocking on purpose:
 * the only way past it is an explicit "I understand" tap.
 */
export function SafetyNotice({ onAcknowledge }: SafetyNoticeProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <m.div
      variants={backdrop}
      initial="hidden"
      animate="visible"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-gray-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="safety-notice-title"
      aria-describedby="safety-notice-intro"
    >
      <m.div
        variants={dialog}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border border-themed-border bg-surface p-5 shadow-xl sm:p-6"
      >
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="h-6 w-6 shrink-0 text-secondary" />
          <h2
            id="safety-notice-title"
            className="font-[family-name:var(--font-display)] text-xl font-semibold text-themed-text"
          >
            Play safely
          </h2>
        </div>
        <p id="safety-notice-intro" className="mb-4 text-base text-themed-muted">
          Findamine hunts happen in the real world. Before you head out:
        </p>
        <SafetyTipList className="mb-5" />
        <button
          ref={buttonRef}
          type="button"
          onClick={onAcknowledge}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          I understand
        </button>
      </m.div>
    </m.div>
  );
}

type AckState = "checking" | "needed" | "acknowledged";

function readLocalAck(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false; // private mode / blocked storage: fall back to the server
  }
}

function writeLocalAck(key: string): void {
  try {
    localStorage.setItem(key, "true");
  } catch {
    // Non-fatal: the server record still covers this user.
  }
}

/**
 * Whether the current player still needs to see the safety notice. The server
 * record (users.metadata) is authoritative; localStorage is the fast path.
 * When the lookup fails the notice is shown: one extra tap beats skipping it.
 */
export function useSafetyAcknowledgement(): {
  status: AckState;
  acknowledge: () => void;
} {
  const [status, setStatus] = useState<AckState>("checking");
  const storageKeyRef = useRef(safetyAckStorageKey(null));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let acked = false;
      try {
        const data = await fetchMe();
        const user = data?.user as { id?: string; metadata?: Record<string, unknown> } | undefined;
        storageKeyRef.current = safetyAckStorageKey(user?.id);
        acked = isSafetyAcknowledged(user?.metadata) || readLocalAck(storageKeyRef.current);
      } catch {
        acked = readLocalAck(storageKeyRef.current);
      }
      if (cancelled) return;
      if (acked) writeLocalAck(storageKeyRef.current);
      setStatus(acked ? "acknowledged" : "needed");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const acknowledge = useCallback(() => {
    setStatus("acknowledged");
    writeLocalAck(storageKeyRef.current);
    // Fire-and-forget: the profile route merges metadata, never replaces it.
    invalidateMe();
    fetch("/api/v1/auth/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metadata: safetyAckMetadata() }),
    }).catch(() => {
      // localStorage still remembers it on this device.
    });
  }, []);

  return { status, acknowledge };
}
