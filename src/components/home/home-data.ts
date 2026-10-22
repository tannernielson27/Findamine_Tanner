/**
 * Pure helpers behind the Home screen: audience defaults, weekly-ring copy,
 * and the friends activity list. Kept free of React so they are unit tested.
 */
import type { AgeBand } from "@/lib/themes/tokens";
import type { WeeklyProgress } from "@/lib/gamification/weekly";
import { distanceMeters, type HuntCardData } from "@/lib/hunts/card-data";

/**
 * hunts.target_audience values a band sees by default on Home, so adults stop
 * seeing kids' hunts (BRIEF.md open finding). "all" is always included.
 */
export function audiencesForBand(band: AgeBand): string[] {
  switch (band) {
    case "adult":
      return ["adults", "all"];
    case "teen":
      return ["teens", "family", "all"];
    default:
      return ["kids", "family", "all"];
  }
}

/** Weekly ring headline: "One more hunt this week", "Goal met this week", ... */
export function weeklyHeadline(p: WeeklyProgress): string {
  const left = p.goal - p.completedThisWeek;
  if (left <= 0) return "Weekly goal done";
  if (left === 1) return "One more hunt this week";
  if (p.completedThisWeek === 0) return `${p.goal} hunts this week`;
  return `${left} more hunts this week`;
}

/** Streak line under the headline. */
export function streakLine(weeks: number): string {
  if (weeks <= 0) return "Finish a hunt to start a streak";
  return `${weeks}-week streak`;
}

/** "just now", "5m ago", "2h ago", "Yesterday", "3d ago". Pure (now is injectable). */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.round((now - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

/** First letters of up to two words: "Maya Jensen" → "MJ". */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

/* ─── Friends activity ──────────────────────────────────────────── */

export interface ActivityPerson {
  id: string;
  display_name: string | null;
}

/** The fields of GET /api/v1/social/friends rows Home reads. */
export interface FriendRowLite {
  status: string;
  created_at: string;
  friend: ActivityPerson | null;
}

/** The fields of GET /api/v1/social/kudos?type=all rows Home reads. */
export interface KudosLite {
  id: string;
  message: string;
  created_at: string;
  sender_id: string;
  receiver_id: string;
  direction?: "sent" | "received";
  sender: { display_name: string | null } | null;
}

export interface FriendActivityItem {
  key: string;
  personId: string;
  name: string;
  /** What happened, after the bold name: "sent you kudos" or "is your friend". */
  action: string;
  /** Second line: quoted kudos message and/or time. */
  detail: string;
}

const RECENT_KUDOS_MS = 24 * 60 * 60 * 1000;

/**
 * Up to `limit` rows: kudos friends sent the viewer (newest first, one per
 * person), then accepted friends with nothing recent. Names arrive already
 * privacy-filtered by the APIs; nothing here widens what the viewer sees.
 *
 * There is no friends' hunt-completion feed yet (needs a backend endpoint),
 * so kudos are the only activity Home can show today.
 */
export function buildFriendActivity(
  friends: readonly FriendRowLite[],
  kudos: readonly KudosLite[],
  limit = 4,
  now: number = Date.now()
): FriendActivityItem[] {
  const items: FriendActivityItem[] = [];
  const seen = new Set<string>();

  const received = kudos
    .filter((k) => k.direction === "received")
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  for (const k of received) {
    if (items.length >= limit) break;
    if (seen.has(k.sender_id)) continue;
    seen.add(k.sender_id);
    const message = k.message.trim();
    const when = timeAgo(k.created_at, now);
    items.push({
      key: `kudos-${k.id}`,
      personId: k.sender_id,
      name: k.sender?.display_name || "A friend",
      action: "sent you kudos",
      detail: [message ? `“${message.length > 60 ? `${message.slice(0, 57)}…` : message}”` : "", when].filter(Boolean).join(" · "),
    });
  }

  for (const f of friends) {
    if (items.length >= limit) break;
    if (f.status !== "accepted" || !f.friend?.id || seen.has(f.friend.id)) continue;
    seen.add(f.friend.id);
    items.push({
      key: `friend-${f.friend.id}`,
      personId: f.friend.id,
      name: f.friend.display_name || "Friend",
      action: "is your friend",
      detail: "Send a quick kudos",
    });
  }

  return items;
}

/** People the viewer already sent kudos to in the last 24 hours. */
export function recentlyKudosed(kudos: readonly KudosLite[], now: number = Date.now()): Set<string> {
  return new Set(
    kudos
      .filter((k) => k.direction === "sent" && now - Date.parse(k.created_at) < RECENT_KUDOS_MS)
      .map((k) => k.receiver_id)
  );
}

/* ─── Near you ──────────────────────────────────────────────────── */

/**
 * Adds straight-line distance from the player and sorts nearest first; hunts
 * without a centre keep their order after the located ones. Returns new
 * objects (input untouched). Pure.
 */
export function withDistances<T extends HuntCardData>(hunts: readonly T[], from: { lat: number; lng: number }): T[] {
  const located: T[] = [];
  const rest: T[] = [];
  for (const h of hunts) {
    if (h.latitude != null && h.longitude != null) {
      located.push({ ...h, distanceMeters: distanceMeters(from, { lat: h.latitude, lng: h.longitude }) });
    } else {
      rest.push({ ...h, distanceMeters: null });
    }
  }
  located.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0));
  return [...located, ...rest];
}
