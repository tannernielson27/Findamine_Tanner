import { NextRequest } from "next/server";
import { createHash } from "crypto";
import { ApiError } from "./api-auth";
import { logger } from "./logger";

/**
 * Rate limiter with Upstash Redis for production and in-memory fallback for local dev.
 *
 * Production: uses @upstash/ratelimit with sliding window (works across Vercel instances).
 * Local dev: falls back to in-memory Map when UPSTASH_REDIS_REST_URL is not set.
 * If Upstash is configured but unreachable, the affected request is counted
 * in-memory (per instance) instead of failing.
 */

// Support all naming conventions:
// - UPSTASH_REDIS_KV_REST_API_URL / _TOKEN (Vercel Marketplace, prefixed)
// - UPSTASH_REDIS_REST_URL / _TOKEN (manual / @upstash/redis default)
// - KV_REST_API_URL / _TOKEN (Vercel Marketplace, unprefixed)
const UPSTASH_URL =
  process.env.UPSTASH_REDIS_KV_REST_API_URL ||
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL;
const UPSTASH_TOKEN =
  process.env.UPSTASH_REDIS_KV_REST_API_TOKEN ||
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN;

const USE_UPSTASH = !!(UPSTASH_URL && UPSTASH_TOKEN);

function getIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

/** The `sub` claim of a JWT, read without verifying (it only picks a bucket). */
function jwtSubject(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload?.sub === "string" && payload.sub.length <= 64 ? payload.sub : null;
  } catch {
    return null;
  }
}

/**
 * The raw value of the @supabase/ssr session cookie. Its name is
 * sb-<project-ref>-auth-token, and long sessions are split into .0, .1, ...
 * chunks that must be joined in order.
 */
function readSupabaseSessionCookie(request: NextRequest): string | null {
  const chunks = request.cookies
    .getAll()
    .map((cookie) => ({ match: /^sb-.+-auth-token(?:\.(\d+))?$/.exec(cookie.name), value: cookie.value }))
    .filter((c): c is { match: RegExpExecArray; value: string } => c.match !== null)
    .sort((a, b) => Number(a.match[1] ?? -1) - Number(b.match[1] ?? -1));
  if (chunks.length === 0) return null;
  return chunks.map((c) => c.value).join("");
}

function sessionCookieSubject(raw: string): string | null {
  try {
    const json = raw.startsWith("base64-")
      ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8")
      : raw;
    const session = JSON.parse(json);
    return typeof session?.access_token === "string" ? jwtSubject(session.access_token) : null;
  } catch {
    return null;
  }
}

/**
 * A stable identifier for the signed-in caller, or null when unauthenticated.
 * Prefers the user id inside the access token (stable across token refreshes).
 * Every Supabase token and session cookie starts with the same characters, so
 * a prefix can never be used here; anything undecodable is hashed whole.
 */
function getSessionIdentity(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token) return jwtSubject(token) ?? fingerprint(token);
  }
  const cookie = readSupabaseSessionCookie(request);
  if (cookie) return sessionCookieSubject(cookie) ?? fingerprint(cookie);
  return null;
}

/**
 * Get a composite rate limit key: userId:IP
 * This ensures students in the same classroom (same IP) get individual limits.
 * Falls back to IP-only for unauthenticated requests.
 */
export function getCompositeKey(request: NextRequest): string {
  const ip = getIp(request);
  const identity = getSessionIdentity(request);
  return identity ? `${identity}:${ip}` : ip;
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

interface RateLimiter {
  /** Count one request against the caller's key (user+IP, or IP-only). */
  check(request: NextRequest): Promise<void>;
  /** Count one request against an explicit key, e.g. an email fingerprint. */
  checkKey(key: string): Promise<void>;
}

function createRateLimiter(opts: {
  max: number;
  windowMs: number;
  prefix: string;
  /**
   * "session" (default): user+IP for signed-in callers, IP otherwise.
   * "ip": always the IP. Use this on unauthenticated endpoints, where a
   * made-up Authorization header would otherwise mint a fresh bucket.
   */
  keyBy?: "session" | "ip";
}): RateLimiter {
  const requestKey = opts.keyBy === "ip" ? getIp : getCompositeKey;

  // In-memory limiter: the only limiter in local dev, and the per-instance
  // fallback when Upstash can't be reached in production.
  const store = new Map<string, { count: number; resetAt: number }>();
  const { max, windowMs } = opts;

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

  // Upstash Redis (production)
  let _limiter: import("@upstash/ratelimit").Ratelimit | null = null;

  async function limitWithUpstash(key: string): Promise<{ success: boolean; reset: number }> {
    if (!_limiter) {
      const { Ratelimit } = await import("@upstash/ratelimit");
      const { Redis } = await import("@upstash/redis");
      _limiter = new Ratelimit({
        redis: new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! }),
        limiter: Ratelimit.slidingWindow(opts.max, msToUpstashDuration(opts.windowMs)),
        prefix: `rl:${opts.prefix}`,
      });
    }
    return _limiter.limit(key);
  }

  async function consume(key: string): Promise<void> {
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
      logUpstashFailure(opts.prefix, error);
      consumeInMemory(key);
      return;
    }

    if (!result.success) {
      throw tooManyRequests(Math.ceil((result.reset - Date.now()) / 1000));
    }
  }

  return {
    check: (request: NextRequest) => consume(requestKey(request)),
    checkKey: (key: string) => consume(key),
  };
}

// Pre-configured limiters

/** Strict limit for sensitive signed-in actions (per user+IP). */
export const authLimiter = createRateLimiter({
  max: 10,
  windowMs: 15 * 60 * 1000, // 10 requests per 15 minutes per user+IP
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
  windowMs: 60 * 1000, // 20 requests per minute per IP
  prefix: "ai",
});

export const generalLimiter = createRateLimiter({
  max: 100,
  windowMs: 60 * 1000, // 100 requests per minute per user+IP
  prefix: "general",
});

export const socialLimiter = createRateLimiter({
  max: 30,
  windowMs: 60 * 1000, // 30 requests per minute per user+IP
  prefix: "social",
});

export const playLimiter = createRateLimiter({
  max: 60,
  windowMs: 60 * 1000, // 60 requests per minute per user+IP
  prefix: "play",
});

export const uploadLimiter = createRateLimiter({
  max: 10,
  windowMs: 60 * 1000, // 10 uploads per minute per user+IP
  prefix: "upload",
});
