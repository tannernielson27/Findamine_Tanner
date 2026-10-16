/**
 * Upstash Redis connection settings, shared by the rate limiter and the
 * moderator-alert debounce. Support all naming conventions:
 * - UPSTASH_REDIS_KV_REST_API_URL / _TOKEN (Vercel Marketplace, prefixed)
 * - UPSTASH_REDIS_REST_URL / _TOKEN (manual / @upstash/redis default)
 * - KV_REST_API_URL / _TOKEN (Vercel Marketplace, unprefixed)
 */
export const UPSTASH_URL =
  process.env.UPSTASH_REDIS_KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL;
export const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN;

export const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

let redis: import("@upstash/redis").Redis | null = null;

/** A lazily created Redis client. Only call when USE_UPSTASH is true. */
export async function getUpstashRedis(): Promise<import("@upstash/redis").Redis> {
  if (!redis) {
    const { Redis } = await import("@upstash/redis");
    redis = new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! });
  }
  return redis;
}
