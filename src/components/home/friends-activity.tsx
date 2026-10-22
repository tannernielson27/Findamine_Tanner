"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart, UserPlus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { socialErrorMessage } from "@/lib/social/friends";
import { cn } from "@/lib/utils/cn";
import { SectionHeader } from "./section-header";
import {
  buildFriendActivity,
  initialsOf,
  recentlyKudosed,
  type FriendActivityItem,
  type FriendRowLite,
  type KudosLite,
} from "./home-data";

/** Message sent by the one-tap kudos button (kudos.message_type "predefined"). */
const ONE_TAP_KUDOS = "Nice work out there!";

const AVATAR_TONES = ["bg-juniper-tint text-juniper", "bg-sky-tint text-link", "bg-brand-light text-brand-dark"] as const;

interface FriendsState {
  items: FriendActivityItem[];
  given: Set<string>;
}

/**
 * Friends list with one-tap kudos (existing GET /social/friends,
 * GET+POST /social/kudos). Children can't send kudos (the API blocks them),
 * so they see the list without the button.
 */
export function FriendsActivity({ canKudos }: { canKudos: boolean }) {
  const [state, setState] = useState<FriendsState | null>(null);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/v1/social/friends").then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch("/api/v1/social/kudos?type=all").then((r) => (r.ok ? r.json() : { kudos: [] })),
    ])
      .then(([friendsJson, kudosJson]) => {
        if (cancelled) return;
        const friends: FriendRowLite[] = Array.isArray(friendsJson?.friends) ? friendsJson.friends : [];
        const kudos: KudosLite[] = Array.isArray(kudosJson?.kudos) ? kudosJson.kudos : [];
        setState({ items: buildFriendActivity(friends, kudos), given: recentlyKudosed(kudos) });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function sendKudos(item: FriendActivityItem) {
    if (sending || state?.given.has(item.personId)) return;
    setSending(item.personId);
    setNotice("");
    try {
      const res = await fetch("/api/v1/social/kudos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receiver_id: item.personId, message: ONE_TAP_KUDOS, message_type: "predefined" }),
      });
      if (res.ok) {
        setState((prev) => (prev ? { ...prev, given: new Set([...prev.given, item.personId]) } : prev));
        setNotice(`Kudos sent to ${item.name}.`);
      } else {
        const data = await res.json().catch(() => ({}));
        setNotice(socialErrorMessage(res.status, data.error, "Couldn't send that kudos. Try again."));
      }
    } catch {
      setNotice("Couldn't send that kudos. Try again.");
    }
    setSending(null);
  }

  return (
    <section aria-labelledby="home-friends" className="mx-4 mt-7">
      <SectionHeader id="home-friends" title="Friends" link={{ href: "/dashboard/social", label: "See all" }} className="px-1" />
      {failed ? (
        <p className="m-0 rounded-card border border-themed-border bg-surface p-5 text-base text-themed-muted">
          Couldn&apos;t load your friends right now.{" "}
          <Link href="/dashboard/social" className="font-semibold text-link">
            Open Social
          </Link>
        </p>
      ) : !state ? (
        <FriendsSkeleton />
      ) : state.items.length === 0 ? (
        <div className="flex flex-col gap-4 rounded-card border border-themed-border bg-surface p-5">
          <div className="flex items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sky-tint text-link" aria-hidden="true">
              <UserPlus className="h-6 w-6" />
            </span>
            <p className="m-0 text-base text-themed-muted">
              Hunts are better with friends. Add yours to trade kudos and see who&apos;s out exploring.
            </p>
          </div>
          <ButtonLink href="/dashboard/social" variant="secondary" block>
            Invite friends
          </ButtonLink>
        </div>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-card border border-themed-border bg-surface p-0">
          {state.items.map((item, i) => {
            const given = state.given.has(item.personId);
            return (
              <li key={item.key} className={cn("flex items-center gap-3 py-3.5 pl-4 pr-3", i > 0 && "border-t border-divider")}>
                <span
                  className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-base font-bold", AVATAR_TONES[i % AVATAR_TONES.length])}
                  aria-hidden="true"
                >
                  {initialsOf(item.name)}
                </span>
                <Link href={`/profile/${item.personId}`} className="flex min-w-0 flex-1 flex-col gap-0.5 text-themed-text no-underline">
                  <span className="text-base">
                    <strong>{item.name}</strong> {item.action}
                  </span>
                  <span className="truncate text-sm text-themed-muted">{item.detail}</span>
                </Link>
                {canKudos && (
                  <button
                    type="button"
                    onClick={() => sendKudos(item)}
                    disabled={given || sending === item.personId}
                    aria-label={given ? `Kudos given to ${item.name}` : `Give kudos to ${item.name}`}
                    aria-pressed={given}
                    className={cn(
                      "flex h-12 w-12 shrink-0 items-center justify-center rounded-full border text-brand transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                      given ? "border-brand-light bg-brand-light" : "border-themed-border bg-surface hover:bg-brand-light/60"
                    )}
                  >
                    <Heart className={cn("h-[22px] w-[22px]", given && "fill-current")} aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p role="status" aria-live="polite" className="m-0 px-1 text-sm text-themed-muted [&:not(:empty)]:pt-2">
        {notice}
      </p>
    </section>
  );
}

function FriendsSkeleton() {
  return (
    <div className="fm-shimmer overflow-hidden rounded-card border border-themed-border bg-surface" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className={cn("flex items-center gap-3 py-3.5 pl-4 pr-3", i > 0 && "border-t border-divider")}>
          <div className="h-11 w-11 shrink-0 rounded-full bg-divider" />
          <div className="flex flex-1 flex-col gap-1.5">
            <div className="h-4 w-3/4 rounded-md bg-divider" />
            <div className="h-3.5 w-1/3 rounded-md bg-divider" />
          </div>
          <div className="h-12 w-12 shrink-0 rounded-full bg-divider" />
        </div>
      ))}
    </div>
  );
}
