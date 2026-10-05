"use client";

import { useEffect, useState } from "react";
import { Check, UserPlus } from "lucide-react";
import {
  answerFriendRequest,
  fetchFriendRows,
  friendLinkWith,
  removeFriendConnection,
  sendFriendRequest,
  type FriendActionResult,
  type FriendLink,
} from "@/lib/social/friends";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-brand px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";
const QUIET =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg disabled:opacity-50";

/**
 * Add friend / Request sent / Accept / Remove for one other player.
 * Reads and writes only the viewer's own friend connections.
 */
export default function FriendButton({ userId }: { userId: string }) {
  const [link, setLink] = useState<FriendLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchFriendRows().then((rows) => {
      if (!cancelled) setLink(friendLinkWith(rows ?? [], userId));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function run(action: () => Promise<FriendActionResult>, done: string) {
    setBusy(true);
    setMessage("");
    const result = await action();
    // Re-read either way: a failed call often means the state moved on
    // (they already asked you, the request was withdrawn, ...).
    const rows = await fetchFriendRows();
    if (rows) setLink(friendLinkWith(rows, userId));
    setMessage(result.ok ? done : result.message);
    setBusy(false);
  }

  if (!link) return null;
  const { state, connectionId } = link;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {state === "none" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => sendFriendRequest(userId), "Request sent.")}
            className={PRIMARY}
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add friend
          </button>
        )}

        {state === "request_sent" && connectionId && (
          <>
            <span className="inline-flex min-h-11 items-center rounded-lg bg-secondary/10 px-4 text-sm font-semibold text-themed-text">
              Request sent
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => removeFriendConnection(connectionId), "Request cancelled.")}
              className={QUIET}
            >
              Cancel request
            </button>
          </>
        )}

        {state === "request_received" && connectionId && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => answerFriendRequest(connectionId, "accepted"), "You're now friends.")}
              className={PRIMARY}
            >
              Accept friend request
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => answerFriendRequest(connectionId, "declined"), "Request declined.")}
              className={QUIET}
            >
              Decline
            </button>
          </>
        )}

        {state === "friends" && connectionId && (
          <>
            <span className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-secondary/10 px-4 text-sm font-semibold text-themed-text">
              <Check className="h-4 w-4 text-secondary" aria-hidden="true" />
              Friends
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Remove this friend?")) {
                  run(() => removeFriendConnection(connectionId), "Friend removed.");
                }
              }}
              className={QUIET}
            >
              Remove friend
            </button>
          </>
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-themed-muted">
        {message}
      </p>
    </div>
  );
}
