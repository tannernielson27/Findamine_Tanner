"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import FriendButton from "@/components/social/friend-button";
import ProfileSafetyActions from "@/components/moderation/profile-safety-actions";

interface BadgeRow {
  earned_at: string;
  badge_types: { code: string; name: string; description: string | null; icon_url: string | null } | null;
}

interface HuntRow {
  hunt_id: string;
  total_score: number | null;
  completed_at: string | null;
  hunts: { title: string | null } | null;
}

interface FriendEntry {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface PeerProfile {
  id: string;
  role: string;
  display_name: string | null;
  avatar_url: string | null;
  real_name: string | null;
  personality_scores: Record<string, Record<string, number>> | null;
  badges: BadgeRow[] | null;
  total_score: number | null;
  hunt_history: HuntRow[] | null;
  friends_list: FriendEntry[] | null;
}

interface ProfileResponse {
  profile: PeerProfile;
  relationship: "self" | "team" | "class" | "public";
  hidden_fields: string[];
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  self: "This is you",
  team: "Your teammate",
  class: "In your class",
  public: "Explorer",
};

const CARD = "rounded-xl border border-themed-border bg-surface p-4 shadow-[var(--shadow-card)]";
const CARD_TITLE = "font-[family-name:var(--font-display)] text-base font-semibold text-themed-text";

function HiddenNote({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-dashed border-themed-border bg-themed-bg px-4 py-3 text-sm text-themed-muted">
      <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>{label} is private</span>
    </div>
  );
}

export default function PeerProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  const [data, setData] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  // Bumped on block/unblock: a block removes the friendship, so the friend
  // button re-reads its state (and is hidden while blocked).
  const [blocked, setBlocked] = useState(false);
  const [friendKey, setFriendKey] = useState(0);

  useEffect(() => {
    fetch(`/api/v1/users/${userId}/profile`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error || "Could not load profile");
        return r.json();
      })
      .then((d: ProfileResponse) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load profile"))
      .finally(() => setLoading(false));
  }, [userId]);

  if (loading) {
    return <main className="mx-auto max-w-2xl px-4 py-6"><p className="text-base text-themed-muted">Loading...</p></main>;
  }
  if (error || !data) {
    return <main className="mx-auto max-w-2xl px-4 py-6"><p className="text-base text-themed-muted">{error || "Not found"}</p></main>;
  }

  const { profile, relationship, hidden_fields } = data;
  const hidden = new Set(hidden_fields);
  const name = profile.display_name || "Anonymous Explorer";

  return (
    <main className="mx-auto max-w-2xl px-4 py-6">
      {/* Header */}
      <header className="flex items-center gap-4 mb-2">
        <div className="w-16 h-16 shrink-0 rounded-full bg-secondary/10 flex items-center justify-center font-[family-name:var(--font-display)] text-2xl text-secondary font-bold overflow-hidden">
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : hidden.has("display_name") ? (
            <Lock className="w-6 h-6 text-themed-muted" aria-hidden="true" />
          ) : (
            name[0]?.toUpperCase() || "?"
          )}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-[family-name:var(--font-display)] text-3xl font-bold text-themed-text">{name}</h1>
          {profile.real_name && <p className="text-base text-themed-text">{profile.real_name}</p>}
          <p className="text-sm text-themed-muted">{RELATIONSHIP_LABEL[relationship]}</p>
        </div>
      </header>

      {relationship === "self" ? (
        <p className="mb-4 text-sm text-themed-muted">
          This is your own profile, so nothing is hidden from you. Other players only see what your
          privacy settings allow.{" "}
          <Link href="/settings/privacy" className="font-medium text-link hover:text-link-dark hover:underline">
            Control what others see →
          </Link>
        </p>
      ) : (
        <>
          {profile.role !== "child" && !blocked && <FriendButton key={friendKey} userId={profile.id} />}
          <ProfileSafetyActions
            userId={profile.id}
            name={profile.display_name || "this player"}
            onBlockChange={(next) => {
              setBlocked(next);
              setFriendKey((k) => k + 1);
            }}
          />
        </>
      )}

      <div className="space-y-3 mt-4">
        {/* Score */}
        {profile.total_score !== null ? (
          <div className={`${CARD} flex items-center justify-between gap-3`}>
            <span className={CARD_TITLE}>Total points</span>
            <span className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums text-themed-text">{profile.total_score}</span>
          </div>
        ) : hidden.has("total_score") ? (
          <HiddenNote label="Total points" />
        ) : null}

        {/* Badges */}
        {profile.badges && profile.badges.length > 0 ? (
          <div className={CARD}>
            <p className={`${CARD_TITLE} mb-2`}>Badges</p>
            <div className="flex flex-wrap gap-2">
              {profile.badges.map((b, i) => (
                <span
                  key={`${b.badge_types?.code || i}`}
                  title={b.badge_types?.description || undefined}
                  className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-sm text-themed-text"
                >
                  {b.badge_types?.name || "Badge"}
                </span>
              ))}
            </div>
          </div>
        ) : hidden.has("badges") ? (
          <HiddenNote label="Badge collection" />
        ) : null}

        {/* Personality */}
        {profile.personality_scores ? (
          <div className={CARD}>
            <p className={`${CARD_TITLE} mb-2`}>Personality Profile</p>
            {Object.entries(profile.personality_scores).map(([type, scores]) => (
              <div key={type} className="mb-1.5">
                <p className="text-sm font-medium text-themed-text capitalize">{type.replace(/_/g, " ")}</p>
                <p className="text-sm text-themed-muted">
                  {Object.entries(scores || {})
                    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${typeof v === "number" ? Math.round(v) : v}`)
                    .join(" · ")}
                </p>
              </div>
            ))}
          </div>
        ) : hidden.has("personality_scores") ? (
          <HiddenNote label="Personality profile" />
        ) : null}

        {/* Hunt history */}
        {profile.hunt_history && profile.hunt_history.length > 0 ? (
          <div className={CARD}>
            <p className={`${CARD_TITLE} mb-2`}>Hunt History</p>
            <ul className="space-y-1.5">
              {profile.hunt_history.map((h, i) => (
                <li key={`${h.hunt_id}-${i}`} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-themed-text">{h.hunts?.title || "Hunt"}</span>
                  <span className="shrink-0 tabular-nums text-themed-muted">
                    {h.total_score ?? 0} pts
                    {h.completed_at ? ` · ${new Date(h.completed_at).toLocaleDateString()}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : hidden.has("hunt_history") ? (
          <HiddenNote label="Hunt history" />
        ) : null}

        {/* Friends */}
        {profile.friends_list && profile.friends_list.length > 0 ? (
          <div className={CARD}>
            <p className={`${CARD_TITLE} mb-2`}>Friends</p>
            <div className="flex flex-wrap gap-2">
              {profile.friends_list.map((f) => (
                <Link
                  key={f.id}
                  href={`/profile/${f.id}`}
                  className="inline-flex min-h-9 items-center rounded-full border border-secondary/20 bg-secondary/10 px-3 text-sm text-themed-text transition-colors hover:bg-secondary/20"
                >
                  {f.display_name || "Anonymous Explorer"}
                </Link>
              ))}
            </div>
          </div>
        ) : hidden.has("friends_list") ? (
          <HiddenNote label="Friends list" />
        ) : null}

        {hidden.has("real_name") && <HiddenNote label="Real name" />}
      </div>
    </main>
  );
}
