import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { ApiError } from "./api-auth";
import { logger } from "./logger";
import { USE_UPSTASH, getUpstashRedis } from "./upstash";

/**
 * Rate limiter with Upstash Redis for production and in-memory fallback for local dev.
 *
 * Production: uses @upstash/ratelimit with sliding window (works across Vercel instances).
 * Local dev: falls back to in-memory Map when UPSTASH_REDIS_REST_URL is not set.
 * If Upstash is configured but unreachable, the affected request is counted
 * in-memory (per instance) instead of failing.
 */

/**
 * The caller's IP: the first hop of x-forwarded-for, which Vercel's edge sets
 * itself (a client-sent value is not passed through), else x-real-ip.
 */
export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/**
 * Bucket keys. Nothing a client can choose freely ever becomes a key: the IP
 * comes from the edge, and a user id only once the route has verified the
 * session (getAuthUser). An unverified cookie or token is never read here, so
 * sending a made-up one cannot mint a fresh bucket.
 */
function ipKey(request: NextRequest): string {
  return `ip:${getClientIp(request)}`;
}

/** Ids are UUIDs; anything odd is hashed so a key can never grow unbounded. */
function userKey(userId: string): string {
  return /^[A-Za-z0-9-]{1,64}$/.test(userId) ? `user:${userId}` : `user:${fingerprint(userId)}`;
}

/**
 * Rate limit key for an email address (trimmed, lowercased, hashed so that
 * addresses are not stored in the limiter). Use with `limiter.checkKey`.
 */
export function emailRateLimitKey(email: string): string {
  return fingerprint(email.trim().toLowerCase());
}

/** "about 4 minutes" / "about a minute" / "a few seconds" for a 429 message. */
export function formatRetryAfter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 20) return "a few seconds";
  if (seconds <= 90) return "about a minute";
  if (seconds < 90 * 60) return `about ${Math.ceil(seconds / 60)} minutes`;
  return `about ${Math.round(seconds / 3600)} hours`;
}

function tooManyRequests(retryAfterSec: number): ApiError {
  return new ApiError(429, `Too many attempts. Please try again in ${formatRetryAfter(retryAfterSec)}.`);
}

function msToUpstashDuration(ms: number): `${number} s` | `${number} m` | `${number} h` {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  if (ms >= 60_000 && ms % 60_000 === 0) return `${ms / 60_000} m`;
  return `${Math.ceil(ms / 1000)} s`;
}

/** An Upstash outage fails every request; log it at most once per interval. */
const UPSTASH_FAILURE_LOG_INTERVAL_MS = 60_000;
let lastUpstashFailureLogAt = 0;

function logUpstashFailure(prefix: string, error: unknown): void {
  const now = Date.now();
  if (now - lastUpstashFailureLogAt < UPSTASH_FAILURE_LOG_INTERVAL_MS) return;
  lastUpstashFailureLogAt = now;
  logger.error("rate_limit.upstash_unavailable", {
    limiter: prefix,
    fallback: "in-memory",
    error: error instanceof Error ? error.message : String(error),
  });
}

export interface RateLimiter {
  /**
   * Count one request. Always against the caller's IP; with a verified user id
   * (from getAuthUser) also against that user, at the limiter's real limit.
   * Pass the user id whenever the route has one: the IP bucket alone is a
   * loose ceiling sized for a whole class behind one campus NAT.
   */
  check(request: NextRequest, userId?: string | null): Promise<void>;
  /** Count one request against an explicit key, e.g. an email fingerprint. */
  checkKey(key: string): Promise<void>;
}

/** Students per shared IP the per-IP ceiling of a per-user limiter allows for. */
const DEFAULT_IP_SHARE = 30;

interface Bucket {
  consume(key: string): Promise<void>;
}

/** One sliding-window counter: Upstash in production, in-memory otherwise or on outage. */
function createBucket(max: number, windowMs: number, prefix: string): Bucket {
  const store = new Map<string, { count: number; resetAt: number }>();
  let lastCleanup = Date.now();

  function cleanup() {
    const now = Date.now();
    if (now - lastCleanup < 60_000) return;
    lastCleanup = now;
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) store.delete(key);
    }
  }

  function consumeInMemory(key: string): void {
    cleanup();
    const now = Date.now();
    const entry = store.get(key);

    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    entry.count++;
    if (entry.count > max) {
      throw tooManyRequests(Math.ceil((entry.resetAt - now) / 1000));
    }
  }

  let limiter: import("@upstash/ratelimit").Ratelimit | null = null;

  async function limitWithUpstash(key: string): Promise<{ success: boolean; reset: number }> {
    if (!limiter) {
      const { Ratelimit } = await import("@upstash/ratelimit");
      limiter = new Ratelimit({
        redis: await getUpstashRedis(),
        limiter: Ratelimit.slidingWindow(max, msToUpstashDuration(windowMs)),
        prefix: `rl:${prefix}`,
        // Per-instance cache of keys already over the limit: a blocked caller
        // is rejected without another Redis round trip.
        ephemeralCache: new Map(),
      });
    }
    return limiter.limit(key);
  }

  return {
    async consume(key: string): Promise<void> {
      if (!USE_UPSTASH) {
        consumeInMemory(key);
        return;
      }

      let result: { success: boolean; reset: number };
      try {
        result = await limitWithUpstash(key);
      } catch (error) {
        // A limiter outage must not turn into a 500 for the user: count this
        // request against this instance's in-memory limiter instead.
        logUpstashFailure(prefix, error);
        consumeInMemory(key);
        return;
      }

      if (!result.success) {
        throw tooManyRequests(Math.ceil((result.reset - Date.now()) / 1000));
      }
    },
  };
}

function createRateLimiter(opts: {
  max: number;
  windowMs: number;
  prefix: string;
  /**
   * "user" (default): `max` per verified user, plus a per-IP ceiling of
   * `max * ipShare` so one network can't flood the route either.
   * "ip": `max` per IP and nothing else. Use this on unauthenticated
   * endpoints (sign-in, sign-up), where there is no verified user yet.
   */
  keyBy?: "user" | "ip";
  /** Override DEFAULT_IP_SHARE for a "user" limiter. */
  ipShare?: number;
}): RateLimiter {
  const perUser = createBucket(opts.max, opts.windowMs, opts.prefix);
  const perIp =
    opts.keyBy === "ip"
      ? perUser
      : createBucket(opts.max * (opts.ipShare ?? DEFAULT_IP_SHARE), opts.windowMs, `${opts.prefix}:ip`);

  return {
    async check(request: NextRequest, userId?: string | null): Promise<void> {
      // The two buckets are independent counters: consume them concurrently.
      // allSettled so both are always counted; the IP bucket's error wins,
      // matching the old IP-then-user order.
      const checks = [perIp.consume(ipKey(request))];
      if (opts.keyBy !== "ip" && typeof userId === "string" && userId) {
        checks.push(perUser.consume(userKey(userId)));
      }
      const results = await Promise.allSettled(checks);
      for (const r of results) {
        if (r.status === "rejected") throw r.reason;
      }
    },
    checkKey: (key: string) => perUser.consume(key),
  };
}

// Pre-configured limiters

/** Strict limit for sensitive signed-in actions (per user). */
export const authLimiter = createRateLimiter({
  max: 10,
  windowMs: 15 * 60 * 1000, // 10 requests per 15 minutes per user
  prefix: "auth",
});

/*
 * Sign-up / sign-in limits. A whole class signs up from one campus NAT, so the
 * per-IP numbers are only a ceiling against floods; the real abuse protection
 * is keyed on the thing being abused (the email address being mailed or
 * guessed). Per-IP limiters ignore auth headers: these endpoints are public.
 */

/** Registration attempts per IP: a 100-seat lecture hall with ~3 tries each. */
export const registerIpLimiter = createRateLimiter({
  max: 300,
  windowMs: 10 * 60 * 1000,
  prefix: "register-ip",
  keyBy: "ip",
});

/** Registration attempts (each can send a confirmation email) per address. */
export const registerEmailLimiter = createRateLimiter({
  max: 5,
  windowMs: 60 * 60 * 1000,
  prefix: "register-email",
});

/** Sign-in attempts per IP (same lecture-hall sizing as registration). */
export const loginIpLimiter = createRateLimiter({
  max: 300,
  windowMs: 10 * 60 * 1000,
  prefix: "login-ip",
  keyBy: "ip",
});

/** Sign-in attempts per account: the password-guessing limit. */
export const loginEmailLimiter = createRateLimiter({
  max: 10,
  windowMs: 15 * 60 * 1000,
  prefix: "login-email",
});

/** Resend-confirmation and forgot-password requests per IP. */
export const authEmailIpLimiter = createRateLimiter({
  max: 100,
  windowMs: 15 * 60 * 1000,
  prefix: "auth-email-ip",
  keyBy: "ip",
});

/** Auth emails sent to one address; key as `<purpose>:<emailRateLimitKey>`. */
export const authEmailLimiter = createRateLimiter({
  max: 3,
  windowMs: 15 * 60 * 1000,
  prefix: "auth-email",
});

/** Parental-consent link clicks per IP (the token itself is unguessable). */
export const consentVerifyLimiter = createRateLimiter({
  max: 60,
  windowMs: 15 * 60 * 1000,
  prefix: "consent-verify",
  keyBy: "ip",
});
export const aiLimiter = createRateLimiter({
  max: 20,
  windowMs: 60 * 1000, // 20 requests per minute per user
  prefix: "ai",
});

export const generalLimiter = createRateLimiter({
  max: 100,
  windowMs: 60 * 1000, // 100 requests per minute per user
  prefix: "general",
});

export const socialLimiter = createRateLimiter({
  max: 30,
  windowMs: 60 * 1000, // 30 requests per minute per user
  prefix: "social",
});

export const playLimiter = createRateLimiter({
  max: 60,
  windowMs: 60 * 1000, // 60 requests per minute per user
  prefix: "play",
});

export const uploadLimiter = createRateLimiter({
  max: 10,
  windowMs: 60 * 1000, // 10 uploads per minute per user
  prefix: "upload",
});

/**
 * Publishing / unpublishing a hunt. Each submission for review emails the
 * reviewers (debounced in src/lib/moderation/notify.ts), so keep it modest.
 */
export const publishLimiter = createRateLimiter({
  max: 20,
  windowMs: 60 * 60 * 1000, // 20 per hour per user
  prefix: "hunt-publish",
});
