/**
 * Contract for "the hunt this player has in progress".
 *
 * Served by GET /api/v1/play/active (response: { data: ActiveHunt | null }).
 * Read by the Home resume card and the active-hunt mini-bar through
 * `useActiveHunt` (lib/hooks/use-active-hunt.ts).
 */

export interface ActiveHunt {
  huntId: string;
  title: string;
  /** 1-based stop the player is on now. */
  currentStop: number;
  totalStops: number;
  /** Stops already finished. */
  completedStops: number;
  /** Where to resume: /play/<huntId>. */
  href: string;
  coverImageUrl: string | null;
  /** ISO time of the player's last action in this session. */
  lastActiveAt: string | null;
}

/** Narrows an unknown JSON payload to ActiveHunt | null. Pure. */
export function parseActiveHunt(payload: unknown): ActiveHunt | null {
  if (!payload || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.huntId !== "string" || typeof d.title !== "string") return null;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const totalStops = Math.max(0, num(d.totalStops, 0));
  return {
    huntId: d.huntId,
    title: d.title,
    totalStops,
    completedStops: Math.min(totalStops, Math.max(0, num(d.completedStops, 0))),
    currentStop: Math.max(1, num(d.currentStop, 1)),
    href: typeof d.href === "string" && d.href.startsWith("/play/") ? d.href : `/play/${d.huntId}`,
    coverImageUrl: typeof d.coverImageUrl === "string" ? d.coverImageUrl : null,
    lastActiveAt: typeof d.lastActiveAt === "string" ? d.lastActiveAt : null,
  };
}
