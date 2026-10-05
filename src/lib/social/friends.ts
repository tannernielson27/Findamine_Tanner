/**
 * Shared shape + pure helpers for friend connections.
 *
 * The friends API returns each connection with both raw sides (`requester`,
 * `addressee`) and a viewer-relative view of it: `friend` (the other person)
 * and `direction` (who asked whom). Names arrive already privacy-filtered by
 * the API; nothing here widens what a viewer can see.
 */

export type FriendDirection = "incoming" | "outgoing";

export interface FriendPerson {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export interface FriendRow {
  id: string;
  status: string;
  created_at: string;
  requester_id: string;
  addressee_id: string;
  friend: FriendPerson | null;
  direction: FriendDirection;
}

interface ConnectionSides<P> {
  requester_id: string;
  addressee_id: string;
  requester: P | null;
  addressee: P | null;
}

/** Add the viewer-relative `friend` and `direction` to a connection row. */
export function withViewerSide<P, R extends ConnectionSides<P>>(
  row: R,
  viewerId: string
): R & { friend: P | null; direction: FriendDirection } {
  const outgoing = row.requester_id === viewerId;
  return {
    ...row,
    friend: outgoing ? row.addressee : row.requester,
    direction: outgoing ? "outgoing" : "incoming",
  };
}

export type FriendState = "none" | "friends" | "request_sent" | "request_received";

export interface FriendLink {
  state: FriendState;
  /** The connection row to accept / decline / remove, when one exists. */
  connectionId: string | null;
}

/** Where the viewer stands with one other player, from their friends list. */
export function friendLinkWith(rows: FriendRow[], otherId: string): FriendLink {
  const row = rows.find((r) => r.friend?.id === otherId);
  if (!row) return { state: "none", connectionId: null };
  if (row.status === "accepted") return { state: "friends", connectionId: row.id };
  if (row.status === "pending") {
    return {
      state: row.direction === "incoming" ? "request_received" : "request_sent",
      connectionId: row.id,
    };
  }
  return { state: "none", connectionId: null };
}

/** The viewer's accepted + pending connections; null when the request fails. */
export async function fetchFriendRows(): Promise<FriendRow[] | null> {
  try {
    const res = await fetch("/api/v1/social/friends?status=all");
    if (!res.ok) return null;
    return ((await res.json()).friends || []) as FriendRow[];
  } catch {
    return null;
  }
}

export interface FriendActionResult {
  ok: boolean;
  /** Player-facing reason when ok is false. */
  message: string;
}

async function friendCall(
  url: string,
  method: "POST" | "PUT" | "DELETE",
  body: Record<string, string> | undefined,
  fallback: string
): Promise<FriendActionResult> {
  try {
    const res = await fetch(url, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (res.ok) return { ok: true, message: "" };
    const err = await res.json().catch(() => ({}));
    return { ok: false, message: socialErrorMessage(res.status, err.error, fallback) };
  } catch {
    return { ok: false, message: "Couldn't reach findamine. Check your connection and try again." };
  }
}

export function sendFriendRequest(userId: string): Promise<FriendActionResult> {
  return friendCall("/api/v1/social/friends", "POST", { addressee_id: userId }, "Couldn't send that request. Try again.");
}

export function answerFriendRequest(
  connectionId: string,
  status: "accepted" | "declined"
): Promise<FriendActionResult> {
  return friendCall(`/api/v1/social/friends/${connectionId}`, "PUT", { status }, "Couldn't update that request. Try again.");
}

/** Remove a friend, or cancel a request you sent. */
export function removeFriendConnection(connectionId: string): Promise<FriendActionResult> {
  return friendCall(`/api/v1/social/friends/${connectionId}`, "DELETE", undefined, "Couldn't remove that. Try again.");
}

/**
 * A message a player can act on for a failed friend/kudos/referral call.
 * 4xx bodies from these routes are written for players, so they pass through;
 * rate limits and server faults get a plain fallback.
 */
export function socialErrorMessage(status: number, serverError: unknown, fallback: string): string {
  if (status === 401) return "Please sign in again.";
  if (status === 429) return "You're going a bit fast. Wait a minute and try again.";
  if (status >= 500) return fallback;
  return typeof serverError === "string" && serverError.trim() ? serverError : fallback;
}
