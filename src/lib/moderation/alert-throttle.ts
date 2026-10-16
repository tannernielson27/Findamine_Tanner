/**
 * Debounce for moderator / reviewer alert emails.
 *
 * claimAlertSlot(key, windowMs) returns true for the first caller in a window
 * and false for everyone after, so a burst of reports or publishes sends one
 * email instead of one per event. Backed by Upstash (SET NX PX, shared by
 * every Vercel instance) when configured; otherwise, or if Upstash is
 * unreachable, by a per-instance in-memory map.
 */
import { USE_UPSTASH, getUpstashRedis } from "@/lib/utils/upstash";
import { logger } from "@/lib/utils/logger";

const memory = new Map<string, number>();

function claimInMemory(key: string, windowMs: number): boolean {
  const now = Date.now();
  const until = memory.get(key);
  if (until !== undefined && until > now) return false;
  memory.set(key, now + windowMs);
  if (memory.size > 1000) {
    for (const [k, expires] of memory) if (expires <= now) memory.delete(k);
  }
  return true;
}

export async function claimAlertSlot(key: string, windowMs: number): Promise<boolean> {
  const fullKey = `alert:${key}`;
  if (!USE_UPSTASH) return claimInMemory(fullKey, windowMs);
  try {
    const redis = await getUpstashRedis();
    const result = await redis.set(fullKey, "1", { nx: true, px: windowMs });
    return result === "OK";
  } catch (error) {
    logger.error("alert_throttle.upstash_unavailable", {
      key,
      fallback: "in-memory",
      error: error instanceof Error ? error.message : String(error),
    });
    return claimInMemory(fullKey, windowMs);
  }
}

/** Test hook: forget every in-memory claim. */
export function resetAlertThrottleForTests(): void {
  memory.clear();
}
