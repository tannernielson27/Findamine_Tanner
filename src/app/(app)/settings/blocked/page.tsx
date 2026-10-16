"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Ban } from "lucide-react";
import { socialErrorMessage } from "@/lib/social/friends";

interface BlockedPlayer {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

type LoadState = "loading" | "ready" | "error";

/** Settings → Blocked players: everyone the viewer has blocked, with Unblock. */
export default function BlockedPlayersPage() {
  const [blocks, setBlocks] = useState<BlockedPlayer[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/v1/social/blocks")
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error);
        setBlocks(data.blocks || []);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  const unblock = async (player: BlockedPlayer) => {
    setBusyId(player.user_id);
    setMessage("");
    const name = player.display_name || "That player";
    const fallback = "Couldn't unblock right now. Try again.";
    try {
      const res = await fetch(`/api/v1/social/blocks/${encodeURIComponent(player.user_id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(socialErrorMessage(res.status, data.error, fallback));
        return;
      }
      setBlocks((prev) => prev.filter((b) => b.user_id !== player.user_id));
      setMessage(`${name} is unblocked.`);
    } catch {
      setMessage(fallback);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-5">
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-dark hover:underline"
      >
        &larr; Settings
      </Link>
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text text-balance">
        Blocked players
      </h1>
      <p className="mt-1 mb-5 text-base text-themed-muted">
        You and a blocked player can&apos;t see each other&apos;s chat messages, kudos, wall posts or
        shoutouts, and neither of you can send the other kudos, shoutouts or friend requests. Blocking
        also removes any friendship between you. They aren&apos;t told that you blocked them.
      </p>

      {state === "loading" ? (
        <div className="fm-shimmer space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-xl border border-themed-border bg-themed-bg" />
          ))}
        </div>
      ) : state === "error" ? (
        <p role="alert" className="text-base font-medium text-[var(--color-error)]">
          Couldn&apos;t load your blocked players. Reload to try again.
        </p>
      ) : blocks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-themed-border p-10 text-center">
          <Ban className="h-6 w-6 text-themed-muted" aria-hidden="true" />
          <p className="text-base text-themed-muted">
            You haven&apos;t blocked anyone. You can block a player from their profile or when you report them.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-themed-border overflow-hidden rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)]">
          {blocks.map((b) => {
            const name = b.display_name || "Player";
            return (
              <li key={b.user_id} className="flex items-center gap-3 px-4 py-2">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary/10 font-[family-name:var(--font-display)] text-sm font-bold text-secondary"
                  aria-hidden="true"
                >
                  {name.trim()[0]?.toUpperCase() || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base text-themed-text">{name}</span>
                  <span className="block text-sm text-themed-muted">
                    Blocked {new Date(b.created_at).toLocaleDateString()}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => unblock(b)}
                  disabled={busyId === b.user_id}
                  className="inline-flex min-h-11 shrink-0 items-center rounded-lg border border-themed-border bg-surface px-4 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 disabled:opacity-50"
                >
                  Unblock
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p role="status" aria-live="polite" className="mt-3 min-h-5 text-sm text-themed-muted">
        {message}
      </p>
    </main>
  );
}
