/**
 * Client-side shapes and calls for one-way follows (GET/POST
 * /api/v1/social/follows, DELETE /api/v1/social/follows/[userId]).
 * Names arrive already privacy-filtered by the API.
 */

import { socialErrorMessage, type FriendActionResult } from "@/lib/social/friends";

export interface FollowPerson {
  user_id: string;
  created_at: string;
  /** Null when this person hides their name from the viewer. */
  display_name: string | null;
  avatar_url: string | null;
}

export interface FollowerPerson extends FollowPerson {
  /** The viewer follows this follower back. */
  you_follow: boolean;
}

export interface FollowLists {
  /** False for accounts that can't use follows; the lists are then empty. */
  available: boolean;
  following: FollowPerson[];
  followers: FollowerPerson[];
}

export interface FollowState {
  available: boolean;
  following: boolean;
  follows_you: boolean;
}

/** The viewer's follows in both directions; null when the request fails. */
export async function fetchFollowLists(): Promise<FollowLists | null> {
  try {
    const res = await fetch("/api/v1/social/follows");
    if (!res.ok) return null;
    const json = await res.json();
    return {
      available: json.available === true,
      following: Array.isArray(json.following) ? json.following : [],
      followers: Array.isArray(json.followers) ? json.followers : [],
    };
  } catch {
    return null;
  }
}

/** Where the viewer stands with one other player; null when the request fails. */
export async function fetchFollowState(userId: string): Promise<FollowState | null> {
  try {
    const res = await fetch(`/api/v1/social/follows?user_id=${encodeURIComponent(userId)}`);
    if (!res.ok) return null;
    const json = await res.json();
    return {
      available: json.available === true,
      following: json.following === true,
      follows_you: json.follows_you === true,
    };
  } catch {
    return null;
  }
}

async function followCall(url: string, init: RequestInit, fallback: string): Promise<FriendActionResult> {
  try {
    const res = await fetch(url, init);
    if (res.ok) return { ok: true, message: "" };
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: socialErrorMessage(res.status, err.error, fallback) };
  } catch {
    return { ok: false, message: "Couldn't reach findamine. Check your connection and try again." };
  }
}

export function followUser(userId: string): Promise<FriendActionResult> {
  return followCall(
    "/api/v1/social/follows",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user_id: userId }) },
    "Couldn't follow that player. Try again."
  );
}

export function unfollowUser(userId: string): Promise<FriendActionResult> {
  return followCall(
    `/api/v1/social/follows/${encodeURIComponent(userId)}`,
    { method: "DELETE" },
    "Couldn't unfollow that player. Try again."
  );
}

/** One member of the viewer's crew, as GET /api/v1/social/referrals lists them. */
export interface CrewMember {
  created_at: string;
  /** The viewer has let this member into their "My Crew" audience. */
  audience_approved?: boolean;
  user: { id: string; display_name: string | null; avatar_url: string | null } | null;
}

/** Let a crew member into the viewer's "My Crew" audience, or take them out. */
export function setCrewAudience(minionId: string, approved: boolean): Promise<FriendActionResult> {
  return followCall(
    "/api/v1/social/referrals/audience",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minion_id: minionId, approved }) },
    "Couldn't update that crew member. Try again."
  );
}

/** Stop someone following the viewer. */
export function removeFollower(userId: string): Promise<FriendActionResult> {
  return followCall(
    `/api/v1/social/follows/${encodeURIComponent(userId)}?direction=follower`,
    { method: "DELETE" },
    "Couldn't remove that follower. Try again."
  );
}
