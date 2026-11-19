"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  fetchFollowLists,
  followUser,
  removeFollower,
  setCrewAudience,
  unfollowUser,
  type CrewMember,
  type FollowLists,
  type FollowPerson,
} from "@/lib/social/follows";
import type { FriendActionResult } from "@/lib/social/friends";

const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-3 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg disabled:opacity-50";
const ROW_BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";
const SUBHEAD = "px-4 pt-3 text-sm font-semibold text-themed-text";

/** Avatar initial + name; a person who hides their name is "A player". */
function PersonLink({ person }: { person: FollowPerson }) {
  const name = person.display_name || "A player";
  return (
    <Link href={`/profile/${person.user_id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 hover:underline">
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary/10 font-[family-name:var(--font-display)] text-sm font-bold text-secondary"
        aria-hidden="true"
      >
        {name.trim()[0]?.toUpperCase() || "?"}
      </span>
      <span className="min-w-0 truncate text-base text-themed-text">{name}</span>
    </Link>
  );
}

/**
 * Who the viewer follows and who follows them, with unfollow, follow back and
 * remove follower. Renders nothing for accounts that can't use follows.
 */
export default function FollowsPanel({ crew = [] }: { crew?: readonly CrewMember[] }) {
  // Approvals changed in this visit, over what the page loaded.
  const [approvals, setApprovals] = useState<Record<string, boolean>>({});
  const [lists, setLists] = useState<FollowLists | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetchFollowLists().then((next) => {
      if (cancelled) return;
      setLists(next);
      setFailed(next === null);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function run(action: () => Promise<FriendActionResult>, done: string) {
    setBusy(true);
    setMessage("");
    const result = await action();
    const next = await fetchFollowLists();
    if (next) setLists(next);
    setMessage(result.ok ? done : result.message);
    setBusy(false);
  }

  async function setApproval(memberId: string, approved: boolean) {
    setBusy(true);
    setMessage("");
    const result = await setCrewAudience(memberId, approved);
    if (result.ok) setApprovals((prev) => ({ ...prev, [memberId]: approved }));
    setMessage(result.ok ? (approved ? "They can now see what you share with My Crew." : "Removed from your My Crew audience.") : result.message);
    setBusy(false);
  }

  if (failed) {
    return (
      <section className="mb-6 rounded-xl border border-themed-border bg-surface p-4 shadow-[var(--shadow-card)]">
        <p role="alert" className="text-base text-themed-text">
          We couldn&apos;t load who you follow.
        </p>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
          className={`${ROW_BUTTON} mt-2`}
        >
          Try again
        </button>
      </section>
    );
  }
  if (!lists?.available) return null;
  const { following, followers } = lists;
  const nameOf = (p: { display_name: string | null }) => p.display_name || "this player";
  const members = crew.flatMap((m) =>
    m.user?.id ? [{ id: m.user.id, display_name: m.user.display_name, approved: approvals[m.user.id] ?? m.audience_approved === true }] : []
  );

  return (
    <section
      aria-labelledby="follows-heading"
      className="mb-6 min-w-0 overflow-hidden rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)]"
    >
      <div className="border-b border-themed-border px-4 py-3">
        <h2 id="follows-heading" className="font-[family-name:var(--font-display)] text-lg font-bold text-themed-text">
          Following
        </h2>
        <p className="mt-0.5 text-sm text-themed-muted">
          Follow any player from their page to keep an eye on them. Nobody has to approve it. Players
          you follow can see what you share with &ldquo;Crew + Following&rdquo; in your{" "}
          <Link href="/settings/privacy" className="font-medium text-link underline hover:text-link-dark">
            privacy settings
          </Link>
          . Following someone doesn&apos;t show you more of theirs.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-themed-border">
        <div className="min-w-0">
          <h3 className={SUBHEAD}>
            You follow (<span className="tabular-nums">{following.length}</span>)
          </h3>
          {following.length === 0 ? (
            <p className="px-4 py-4 text-base text-themed-muted">
              Nobody yet. Open a player&apos;s name on the{" "}
              <Link href="/leaderboard" className="font-medium text-link underline hover:text-link-dark">
                leaderboard
              </Link>{" "}
              and choose Follow.
            </p>
          ) : (
            <ul className="divide-y divide-themed-border">
              {following.map((p) => (
                <li key={p.user_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <PersonLink person={p} />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => unfollowUser(p.user_id), "Unfollowed.")}
                    aria-label={`Unfollow ${nameOf(p)}`}
                    className={ROW_BUTTON}
                  >
                    Unfollow
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="min-w-0 border-t border-themed-border lg:border-t-0">
          <h3 className={SUBHEAD}>
            Follow you (<span className="tabular-nums">{followers.length}</span>)
          </h3>
          {followers.length === 0 ? (
            <p className="px-4 py-4 text-base text-themed-muted">Nobody follows you yet.</p>
          ) : (
            <ul className="divide-y divide-themed-border">
              {followers.map((p) => (
                <li key={p.user_id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <PersonLink person={p} />
                  {!p.you_follow && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => run(() => followUser(p.user_id), "Following.")}
                      aria-label={`Follow ${nameOf(p)} back`}
                      className={ROW_BUTTON_PRIMARY}
                    >
                      Follow back
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => removeFollower(p.user_id), "Follower removed.")}
                    aria-label={`Remove ${nameOf(p)} from your followers`}
                    className={ROW_BUTTON}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {members.length > 0 && (
        <div className="border-t border-themed-border">
          <h3 className={SUBHEAD}>Your crew&apos;s access</h3>
          <p className="px-4 pt-1 text-sm text-themed-muted">
            Anyone with your invite link can join your crew. They see what you share with &ldquo;My Crew&rdquo;
            only after you approve them here. Points are the same either way.
          </p>
          <ul className="divide-y divide-themed-border">
            {members.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <PersonLink person={{ user_id: m.id, created_at: "", display_name: m.display_name, avatar_url: null }} />
                {m.approved ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setApproval(m.id, false)}
                    aria-label={`Remove ${nameOf(m)} from your My Crew audience`}
                    className={ROW_BUTTON}
                  >
                    Approved · Remove
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setApproval(m.id, true)}
                    aria-label={`Approve ${nameOf(m)} for your My Crew audience`}
                    className={ROW_BUTTON_PRIMARY}
                  >
                    Approve
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p role="status" aria-live="polite" className="min-h-5 border-t border-themed-border px-4 py-2 text-sm text-themed-muted">
        {message}
      </p>
    </section>
  );
}
