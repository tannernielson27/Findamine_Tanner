"use client";

import { useEffect, useState } from "react";
import { Check, Eye } from "lucide-react";
import { fetchFollowState, followUser, unfollowUser, type FollowState } from "@/lib/social/follows";
import type { FriendActionResult } from "@/lib/social/friends";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";
const QUIET =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg disabled:opacity-50";
const CHIP =
  "inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary/10 px-4 text-sm font-semibold text-themed-text";

/**
 * Follow / Following for one other player. Following needs no approval.
 * Renders nothing for accounts that can't use follows.
 */
export default function FollowButton({ userId }: { userId: string }) {
  const [state, setState] = useState<FollowState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchFollowState(userId).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function run(action: () => Promise<FriendActionResult>, done: string, nowFollowing: boolean) {
    setBusy(true);
    setMessage("");
    const result = await action();
    // Re-read either way: a failed call often means the state moved on. If the
    // re-read fails after a success, show the state the action just produced.
    const next = await fetchFollowState(userId);
    if (next) setState(next);
    else if (result.ok) setState((prev) => (prev ? { ...prev, following: nowFollowing } : prev));
    setMessage(result.ok ? done : result.message);
    setBusy(false);
  }

  if (!state?.available) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {state.following ? (
          <>
            <span className={CHIP}>
              <Check className="h-4 w-4 text-secondary" aria-hidden="true" />
              Following
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => unfollowUser(userId), "You stopped following this player.", false)}
              className={QUIET}
            >
              Unfollow
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => followUser(userId), "You're following this player.", true)}
            className={PRIMARY}
          >
            <Eye className="h-4 w-4" aria-hidden="true" />
            {state.follows_you ? "Follow back" : "Follow"}
          </button>
        )}
        {state.follows_you && <span className="text-sm text-themed-muted">Follows you</span>}
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-themed-muted">
        {message}
      </p>
    </div>
  );
}
