"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, Flag } from "lucide-react";
import ReportDialog, { type ReportOutcome } from "./report-dialog";
import { socialErrorMessage } from "@/lib/social/friends";

const QUIET =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50";

interface ProfileSafetyActionsProps {
  userId: string;
  name: string;
  /** Called after a block/unblock so the page can refresh friend state etc. */
  onBlockChange?: (blocked: boolean) => void;
}

/** Report and Block/Unblock for another player's profile. */
export default function ProfileSafetyActions({ userId, name, onBlockChange }: ProfileSafetyActionsProps) {
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [message, setMessage] = useState("");
  const onChangeRef = useRef(onBlockChange);

  useEffect(() => {
    onChangeRef.current = onBlockChange;
  }, [onBlockChange]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/social/blocks?user_id=${encodeURIComponent(userId)}`)
      .then((r) => (r.ok ? r.json() : { blocked: false }))
      .then((d) => {
        if (cancelled) return;
        setBlocked(!!d.blocked);
        if (d.blocked) onChangeRef.current?.(true);
      })
      .catch(() => {
        if (!cancelled) setBlocked(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const updateBlocked = (next: boolean) => {
    setBlocked(next);
    onChangeRef.current?.(next);
  };

  const toggleBlock = async () => {
    if (blocked === null || busy) return;
    if (!blocked && !window.confirm(`Block ${name}? You won't see each other's messages or kudos, and any friendship is removed.`)) {
      return;
    }
    setBusy(true);
    setMessage("");
    const fallback = blocked ? "Couldn't unblock right now. Try again." : "Couldn't block right now. Try again.";
    try {
      const res = blocked
        ? await fetch(`/api/v1/social/blocks/${encodeURIComponent(userId)}`, { method: "DELETE" })
        : await fetch("/api/v1/social/blocks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(socialErrorMessage(res.status, data.error, fallback));
        return;
      }
      updateBlocked(!blocked);
      setMessage(blocked ? `${name} is unblocked.` : `${name} is blocked.`);
    } catch {
      setMessage(fallback);
    } finally {
      setBusy(false);
    }
  };

  const closeReport = useCallback(() => setReporting(false), []);

  const handleReported = (outcome: ReportOutcome) => {
    setReporting(false);
    if (outcome.blocked) updateBlocked(true);
    setMessage(
      outcome.blocked
        ? `Thanks for reporting. ${name} is now blocked.`
        : "Thanks for reporting. A moderator will review it."
    );
  };

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => setReporting(true)} className={QUIET}>
          <Flag className="h-4 w-4" aria-hidden="true" />
          Report
        </button>
        <button type="button" onClick={toggleBlock} disabled={blocked === null || busy} className={QUIET}>
          <Ban className="h-4 w-4" aria-hidden="true" />
          {blocked ? "Unblock" : "Block"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-themed-muted">
        {message}
      </p>

      {reporting && (
        <ReportDialog
          targetType="user"
          targetId={userId}
          subjectLabel={name}
          canBlock={!blocked}
          onClose={closeReport}
          onReported={handleReported}
        />
      )}
    </div>
  );
}
