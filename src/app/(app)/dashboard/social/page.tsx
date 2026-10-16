"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Flag } from "lucide-react";
import ReportDialog, { type ReportOutcome } from "@/components/moderation/report-dialog";
import StreakDisplay from "@/components/gamification/streak-display";
import { buildKudosRecipients, type RecipientGroup } from "@/lib/social/recipients";
import { RECRUIT_BONUS, WELCOME_BONUS } from "@/lib/utils/referral-rewards";
import {
  answerFriendRequest,
  fetchFriendRows,
  removeFriendConnection,
  socialErrorMessage,
  type FriendActionResult,
  type FriendRow,
} from "@/lib/social/friends";

interface Kudos {
  id: string;
  message: string;
  created_at: string;
  sender_id: string;
  /** Viewer-relative; only received kudos can be reported. */
  direction?: "sent" | "received";
  sender: { display_name: string | null } | null;
  receiver: { display_name: string | null } | null;
}

interface ReferralPerson {
  created_at: string;
  user: { id: string; display_name: string | null; avatar_url: string | null } | null;
}

interface ReferralEarning {
  amount: number;
  created_at: string;
  description: string | null;
}

interface ReferralInfo {
  code: string | null;
  minion_count: number;
  referral_points: number;
  minions: ReferralPerson[];
  recruiter: ReferralPerson | null;
  recent_earnings: ReferralEarning[];
  /** Storyline S3: "silent" omits the gate fields below entirely. */
  forfeit_notice?: "shown" | "silent";
  disclosure_eligible?: boolean;
  forfeited_points?: number;
}

const GROUP_LABELS: Record<RecipientGroup, string> = {
  friend: "Friends",
  minion: "Your crew",
  recruiter: "Your recruiter",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

function initial(name: string | null | undefined): string {
  return (name || "?").trim()[0]?.toUpperCase() || "?";
}

const REDEEM_ERRORS: Record<string, string> = {
  self_referral: "You can't use your own code.",
  already_recruited: "You already have a recruiter.",
  invalid_code: "That code didn't work. Check it and try again.",
};

const ROW_BUTTON =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-themed-border bg-surface px-3 text-sm font-semibold text-themed-text transition-colors hover:bg-themed-bg disabled:opacity-50";
const ROW_BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-brand px-3 text-sm font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50";

/** Avatar + name for one friend row; links to the profile when we know who it is. */
function FriendIdentity({ person }: { person: FriendRow["friend"] }) {
  const body = (
    <>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary/10 font-[family-name:var(--font-display)] text-sm font-bold text-secondary" aria-hidden="true">
        {initial(person?.display_name)}
      </span>
      <span className="min-w-0 truncate text-base text-themed-text">{person?.display_name || "Player"}</span>
    </>
  );
  return person?.id ? (
    <Link href={`/profile/${person.id}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 hover:underline">
      {body}
    </Link>
  ) : (
    <span className="flex min-h-11 min-w-0 flex-1 items-center gap-3">{body}</span>
  );
}

export default function SocialPage() {
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [friendBusy, setFriendBusy] = useState(false);
  const [friendMsg, setFriendMsg] = useState("");
  const [kudosError, setKudosError] = useState("");
  const [shareLink, setShareLink] = useState("");
  const [kudos, setKudos] = useState<Kudos[]>([]);
  const [loading, setLoading] = useState(true);
  const [kudosMessage, setKudosMessage] = useState("");
  const [kudosReceiverId, setKudosReceiverId] = useState("");
  const [sending, setSending] = useState(false);
  const [referral, setReferral] = useState<ReferralInfo | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemMsg, setRedeemMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [reportingKudos, setReportingKudos] = useState<Kudos | null>(null);
  const [kudosNotice, setKudosNotice] = useState("");

  useEffect(() => {
    async function load() {
      // Friends: accepted + pending. Kudos: sent as well as received, so a
      // kudos you just sent is still there after a reload.
      const [friendRows, kudosRes, referralRes] = await Promise.all([
        fetchFriendRows(),
        fetch("/api/v1/social/kudos?type=all"),
        fetch("/api/v1/social/referrals"),
      ]);
      if (friendRows) setFriends(friendRows);
      if (kudosRes.ok) setKudos((await kudosRes.json()).kudos || []);
      if (referralRes.ok) setReferral(await referralRes.json());
      setLoading(false);
    }
    load();
  }, []);

  const handleRedeem = async () => {
    if (!redeemCode.trim()) return;
    setRedeemMsg("");
    const res = await fetch("/api/v1/social/referrals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: redeemCode.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      // Show the new recruiter straight away (this also hides the code box).
      setReferral((prev) => (prev ? { ...prev, recruiter: data.recruiter ?? { created_at: new Date().toISOString(), user: null } } : prev));
      setRedeemMsg(`You joined a crew: +${WELCOME_BONUS} bonus points added.`);
      setRedeemCode("");
    } else {
      setRedeemMsg(
        REDEEM_ERRORS[data.error as string] ??
          socialErrorMessage(res.status, null, "Couldn't redeem that code right now. Try again in a moment.")
      );
    }
  };

  const handleFriendAction = async (action: () => Promise<FriendActionResult>, done: string) => {
    setFriendBusy(true);
    setFriendMsg("");
    const result = await action();
    const rows = await fetchFriendRows();
    if (rows) setFriends(rows);
    setFriendMsg(result.ok ? done : result.message);
    setFriendBusy(false);
  };

  const handleShare = async () => {
    if (!referral?.code) return;
    // The register page reads ?ref= and redeems the code at signup.
    const link = `${window.location.origin}/register?ref=${encodeURIComponent(referral.code)}`;
    const text = `Join my crew on findamine! Sign up with my link and you start with ${WELCOME_BONUS} bonus points.`;
    setShareLink("");
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: "Join me on findamine", text, url: link });
        return;
      } catch (err) {
        // Closing the share sheet is a choice, not a failure: copy nothing.
        if (err instanceof DOMException && err.name === "AbortError") return;
        /* sharing isn't possible here — fall through to copy */
      }
    }
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // No share sheet and no clipboard: show the link so it can be copied by hand.
      setShareLink(link);
    }
  };

  const handleSendKudos = async () => {
    if (!kudosMessage.trim() || !kudosReceiverId || sending) return;
    setSending(true);
    setKudosError("");
    const fallback = "Couldn't send that kudos. Try again.";
    try {
      const res = await fetch("/api/v1/social/kudos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiver_id: kudosReceiverId, message: kudosMessage }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.kudos) {
        setKudos((prev) => [data.kudos, ...prev]);
        setKudosMessage("");
        setKudosReceiverId("");
      } else {
        setKudosError(socialErrorMessage(res.status, data.error, fallback));
      }
    } catch {
      setKudosError(fallback);
    }
    setSending(false);
  };

  const closeKudosReport = useCallback(() => setReportingKudos(null), []);

  const handleKudosReported = async (reported: Kudos, outcome: ReportOutcome) => {
    // Hidden for the reporter straight away; a block hides all of that
    // player's kudos and removes the friendship, so refresh friends too.
    setKudos((prev) =>
      prev.filter((k) => k.id !== reported.id && !(outcome.blocked && k.sender_id === reported.sender_id))
    );
    setReportingKudos(null);
    setKudosNotice(
      outcome.blocked
        ? "Thanks for reporting. You won't see this player anymore."
        : "Thanks for reporting. A moderator will review it."
    );
    if (outcome.blocked) {
      const rows = await fetchFriendRows();
      if (rows) setFriends(rows);
    }
  };

  const acceptedFriends = friends.filter((f) => f.status === "accepted");
  const incomingRequests = friends.filter((f) => f.status === "pending" && f.direction === "incoming");
  const sentRequests = friends.filter((f) => f.status === "pending" && f.direction === "outgoing");

  const recipients = buildKudosRecipients({
    friends: acceptedFriends,
    minions: referral?.minions,
    recruiter: referral?.recruiter,
  });
  const recipientGroups: RecipientGroup[] = ["friend", "minion", "recruiter"];

  return (
    <main className="mx-auto max-w-4xl px-4 py-5">
      <header className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div className="min-w-0">
          <Link href="/dashboard" className="inline-flex min-h-11 items-center text-sm font-medium text-link hover:text-link-dark hover:underline">
            &larr; Dashboard
          </Link>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text text-balance">
            Your crew
          </h1>
        </div>
        <StreakDisplay />
      </header>

      {loading ? (
        <div className="fm-shimmer space-y-4">
          <div className="h-40 bg-themed-bg border border-themed-border rounded-xl" />
          <div className="h-48 bg-themed-bg border border-themed-border rounded-xl" />
        </div>
      ) : (
        <>
          {/* ── Referral economy: the incentive engine, made visible ── */}
          <section className="relative overflow-hidden rounded-xl bg-brand-dark p-5 sm:p-6 mb-6 text-white shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0 max-w-md">
                <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold">Recruit &amp; earn</h2>
                <p className="text-base text-white/90 mt-1">
                  Share your invite link. Friends who join with it start with {WELCOME_BONUS} bonus
                  points and become part of your crew. You earn {RECRUIT_BONUS} points when they
                  finish their first find, plus a share every time they score.
                </p>
                {referral?.code && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <code className="min-w-0 break-all rounded-lg bg-white/15 px-4 py-2 font-mono text-xl font-bold tracking-widest">
                      {referral.code}
                    </code>
                    <button
                      onClick={handleShare}
                      className="min-h-11 max-w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-dark transition-colors hover:bg-white/90 focus-visible:outline-white"
                    >
                      {copied ? "Link copied!" : "Share invite link"}
                    </button>
                  </div>
                )}
                {shareLink && (
                  <label className="mt-3 block text-sm text-white/90">
                    Copy your invite link:
                    <input
                      readOnly
                      value={shareLink}
                      onFocus={(e) => e.currentTarget.select()}
                      className="mt-1 block min-h-11 w-full rounded-lg border border-white/40 bg-white/10 px-3 py-2 font-mono text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    />
                  </label>
                )}
              </div>

              <div className="flex shrink-0 gap-6">
                <div className="text-center">
                  <div className="font-[family-name:var(--font-display)] text-4xl font-bold tabular-nums">{referral?.minion_count ?? 0}</div>
                  <div className="text-sm text-white/90 mt-0.5">in your crew</div>
                </div>
                <div className="text-center">
                  <div className="font-[family-name:var(--font-display)] text-4xl font-bold tabular-nums">{referral?.referral_points ?? 0}</div>
                  <div className="text-sm text-white/90 mt-0.5">points earned</div>
                </div>
              </div>
            </div>

            {/* Crew avatars */}
            {referral && referral.minions.length > 0 && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <div className="flex -space-x-2">
                  {referral.minions.slice(0, 8).map((m, i) =>
                    m.user?.id ? (
                      <Link
                        key={m.user.id}
                        href={`/profile/${m.user.id}`}
                        title={m.user.display_name ?? "Crew member"}
                        aria-label={`${m.user.display_name ?? "Crew member"}'s profile`}
                        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-brand-dark bg-white/90 text-sm font-bold text-brand-dark hover:bg-white focus-visible:outline-white"
                      >
                        {initial(m.user.display_name)}
                      </Link>
                    ) : (
                      <div
                        key={i}
                        title="Crew member"
                        className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-brand-dark bg-white/90 text-sm font-bold text-brand-dark"
                      >
                        {initial(null)}
                      </div>
                    )
                  )}
                </div>
                {referral.minion_count > 8 && (
                  <span className="text-sm tabular-nums text-white/90">+{referral.minion_count - 8} more</span>
                )}
              </div>
            )}

            {/* Recruited-by */}
            {referral?.recruiter && (
              <p className="mt-4 text-sm text-white/90">
                Recruited by{" "}
                {referral.recruiter.user?.id ? (
                  <Link href={`/profile/${referral.recruiter.user.id}`} className="font-semibold text-white underline underline-offset-2">
                    {referral.recruiter.user.display_name ?? "your recruiter"}
                  </Link>
                ) : (
                  <span className="font-semibold text-white">your recruiter</span>
                )}{" "}
                — score well to reward them.
              </p>
            )}
            {referral?.recruiter && redeemMsg && (
              <p role="status" className="mt-2 text-sm font-medium text-white">{redeemMsg}</p>
            )}

            {/* Redeem someone else's code (only meaningful if not yet recruited) */}
            {!referral?.recruiter && (
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/25 pt-4">
                <input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value.toUpperCase().slice(0, 8))}
                  placeholder="Got a code?"
                  aria-label="Got a code?"
                  className="min-h-11 w-40 min-w-0 rounded-lg border border-white/40 bg-white/10 px-3 py-2 text-base font-mono text-white placeholder-white/75 focus:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                />
                <button
                  onClick={handleRedeem}
                  disabled={!redeemCode.trim()}
                  className="min-h-11 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-brand-dark transition-colors hover:bg-white/90 focus-visible:outline-white disabled:opacity-60"
                >
                  Join a crew
                </button>
                {redeemMsg && <span role="status" className="text-sm text-white">{redeemMsg}</span>}
              </div>
            )}
          </section>

          {/* Disclosure gate — hidden profiles don't collect crew bonuses. The
              cost of privacy is shown, not just applied (prospectus §3.2) —
              unless the participant is in the S3 "silent" arm. Only active
              study participants are gated at all: the API reports everyone
              else as "silent" with no gate status, so this never renders
              for them. */}
          {referral && referral.forfeit_notice !== "silent" && referral.disclosure_eligible === false && (
            <section className="rounded-xl border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4 mb-6">
              <p className="text-sm font-medium text-themed-text mb-1">
                Your crew bonuses are paused
              </p>
              <p className="text-sm text-themed-muted">
                Your name or score is hidden, so crew points aren&apos;t being
                collected{referral.forfeited_points ? (
                  <> — you&apos;ve missed <strong className="tabular-nums">{referral.forfeited_points} points</strong> so far</>
                ) : null}.{" "}
                <Link href="/settings/privacy" className="text-link hover:text-link-dark underline font-medium">
                  Review privacy settings
                </Link>
              </p>
            </section>
          )}

          {/* Recent earnings feed — passive income, made tangible */}
          {referral && referral.recent_earnings.length > 0 && (
            <section className="rounded-xl border border-themed-border bg-surface p-4 mb-6 shadow-[var(--shadow-card)]">
              <h3 className="font-[family-name:var(--font-display)] text-base font-bold text-themed-text mb-3">
                Crew activity
              </h3>
              <ul className="space-y-2">
                {referral.recent_earnings.map((e, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 text-themed-muted">
                      {e.description || "Referral bonus from a crew member's find"}
                    </span>
                    <span className="flex shrink-0 items-center gap-3 whitespace-nowrap">
                      <span className="font-[family-name:var(--font-display)] font-bold tabular-nums text-secondary">+{e.amount}</span>
                      <span className="text-sm text-themed-muted">{timeAgo(e.created_at)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Friends */}
            <section className="min-w-0 rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)] overflow-hidden">
              <div className="border-b border-themed-border px-4 py-3">
                <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-themed-text">
                  Friends (<span className="tabular-nums">{acceptedFriends.length}</span>)
                </h2>
              </div>
              {/* Requests waiting on the viewer */}
              {incomingRequests.length > 0 && (
                <div className="border-b border-themed-border bg-[var(--color-warning)]/10">
                  <h3 className="px-4 pt-3 text-sm font-semibold text-themed-text">
                    Friend requests (<span className="tabular-nums">{incomingRequests.length}</span>)
                  </h3>
                  <ul className="divide-y divide-themed-border">
                    {incomingRequests.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                        <FriendIdentity person={f.friend} />
                        <button
                          type="button"
                          disabled={friendBusy}
                          onClick={() => handleFriendAction(() => answerFriendRequest(f.id, "accepted"), "You're now friends.")}
                          className={ROW_BUTTON_PRIMARY}
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={friendBusy}
                          onClick={() => handleFriendAction(() => answerFriendRequest(f.id, "declined"), "Request declined.")}
                          className={ROW_BUTTON}
                        >
                          Decline
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {acceptedFriends.length === 0 ? (
                <p className="p-8 text-center text-base text-themed-muted">
                  No friends yet. Open a player&apos;s name on the{" "}
                  <Link href="/leaderboard" className="font-medium text-link hover:text-link-dark underline">leaderboard</Link>,
                  in team chat or in your crew, then choose Add friend.
                </p>
              ) : (
                <ul className="divide-y divide-themed-border">
                  {acceptedFriends.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                      <FriendIdentity person={f.friend} />
                      <button
                        type="button"
                        disabled={friendBusy}
                        onClick={() => {
                          if (window.confirm("Remove this friend?")) {
                            handleFriendAction(() => removeFriendConnection(f.id), "Friend removed.");
                          }
                        }}
                        className={ROW_BUTTON}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* Requests the viewer sent that haven't been answered */}
              {sentRequests.length > 0 && (
                <div className="border-t border-themed-border">
                  <h3 className="px-4 pt-3 text-sm font-semibold text-themed-text">Requests you sent</h3>
                  <ul className="divide-y divide-themed-border">
                    {sentRequests.map((f) => (
                      <li key={f.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                        <FriendIdentity person={f.friend} />
                        <button
                          type="button"
                          disabled={friendBusy}
                          onClick={() => handleFriendAction(() => removeFriendConnection(f.id), "Request cancelled.")}
                          className={ROW_BUTTON}
                        >
                          Cancel
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {friendMsg && (
                <p role="status" className="border-t border-themed-border px-4 py-2.5 text-sm text-themed-muted">
                  {friendMsg}
                </p>
              )}
            </section>

            {/* Kudos */}
            <section className="min-w-0 rounded-xl border border-themed-border bg-surface shadow-[var(--shadow-card)] overflow-hidden">
              <div className="border-b border-themed-border px-4 py-3">
                <h2 className="font-[family-name:var(--font-display)] text-lg font-bold text-themed-text">Kudos</h2>
                <p className="text-sm text-themed-muted mt-0.5">Cheer on friends, crew, and your recruiter.</p>
              </div>

              {recipients.length > 0 && (
                <div className="p-4 border-b border-themed-border space-y-2">
                  <select
                    value={kudosReceiverId}
                    onChange={(e) => setKudosReceiverId(e.target.value)}
                    aria-label="Send kudos to"
                    className="block min-h-11 w-full rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                  >
                    <option value="">Send kudos to…</option>
                    {recipientGroups.map((g) => {
                      const inGroup = recipients.filter((r) => r.group === g);
                      if (inGroup.length === 0) return null;
                      return (
                        <optgroup key={g} label={GROUP_LABELS[g]}>
                          {inGroup.map((r) => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={kudosMessage}
                      onChange={(e) => setKudosMessage(e.target.value.slice(0, 200))}
                      placeholder="Great teamwork today!"
                      aria-label="Kudos message"
                      className="min-h-11 min-w-0 flex-1 basis-40 rounded-lg border border-themed-border bg-surface px-3 py-2 text-base text-themed-text focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
                      onKeyDown={(e) => e.key === "Enter" && handleSendKudos()}
                    />
                    <button
                      onClick={handleSendKudos}
                      disabled={!kudosMessage.trim() || !kudosReceiverId || sending}
                      className="min-h-11 shrink-0 rounded-lg bg-brand px-5 text-base font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-50"
                    >
                      Send
                    </button>
                  </div>
                  {kudosError && (
                    <p role="alert" className="text-sm font-medium text-[var(--color-error)]">{kudosError}</p>
                  )}
                </div>
              )}

              {kudosNotice && (
                <p role="status" className="border-b border-themed-border px-4 py-2.5 text-sm text-themed-muted">
                  {kudosNotice}
                </p>
              )}

              {kudos.length === 0 ? (
                <p className="p-8 text-center text-base text-themed-muted">No kudos yet.</p>
              ) : (
                <div className="divide-y divide-themed-border max-h-72 overflow-y-auto">
                  {kudos.map((k) => (
                    <div key={k.id} className="flex items-start gap-2 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-base text-themed-text break-words">&ldquo;{k.message}&rdquo;</p>
                        <p className="text-sm text-themed-muted mt-1">
                          {k.sender?.display_name || "Someone"} &rarr; {k.receiver?.display_name || "Someone"}
                          {" · "}
                          {timeAgo(k.created_at)}
                        </p>
                      </div>
                      {k.direction === "received" && (
                        <button
                          type="button"
                          onClick={() => setReportingKudos(k)}
                          aria-label={`Report kudos from ${k.sender?.display_name || "this player"}`}
                          className="-mr-2 inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm text-themed-muted transition-colors hover:text-[var(--color-error)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                        >
                          <Flag className="h-4 w-4" aria-hidden="true" />
                          Report
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {reportingKudos && (
        <ReportDialog
          targetType="kudos"
          targetId={reportingKudos.id}
          subjectLabel="this kudos"
          canBlock
          onClose={closeKudosReport}
          onReported={(outcome) => handleKudosReported(reportingKudos, outcome)}
        />
      )}
    </main>
  );
}
