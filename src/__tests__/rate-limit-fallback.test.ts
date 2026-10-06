import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";

/**
 * Upstash is configured but unreachable: requests must be counted by the
 * in-memory limiter instead of failing with a 500. No real Redis is contacted.
 */

const upstash = vi.hoisted(() => ({
  limit: vi.fn(),
  error: vi.fn(),
}));

type RateLimitModule = typeof import("@/lib/utils/rate-limit");
let rl: RateLimitModule;

beforeAll(async () => {
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.invalid");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "test-token");
  vi.resetModules();
  vi.doMock("@upstash/ratelimit", () => ({
    Ratelimit: class {
      static slidingWindow() {
        return {};
      }
      limit = upstash.limit;
    },
  }));
  vi.doMock("@upstash/redis", () => ({ Redis: class {} }));
  vi.doMock("@/lib/utils/logger", () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: upstash.error },
  }));
  rl = await import("@/lib/utils/rate-limit");
});

afterAll(() => {
  vi.doUnmock("@upstash/ratelimit");
  vi.doUnmock("@upstash/redis");
  vi.doUnmock("@/lib/utils/logger");
  vi.unstubAllEnvs();
});

beforeEach(() => {
  upstash.limit.mockReset();
});

function request(ip: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/anything", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

async function statusOf(run: () => Promise<void>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 500;
  }
}

describe("rate limiter when Upstash is unreachable", () => {
  it("lets the request through and logs the outage", async () => {
    upstash.limit.mockRejectedValue(new Error("fetch failed"));

    expect(await statusOf(() => rl.generalLimiter.check(request("10.1.0.1")))).toBe(200);
    expect(upstash.error).toHaveBeenCalledWith(
      "rate_limit.upstash_unavailable",
      expect.objectContaining({ fallback: "in-memory", error: "fetch failed" })
    );
  });

  it("still enforces the limit in memory during the outage", async () => {
    upstash.limit.mockRejectedValue(new Error("fetch failed"));

    for (let i = 0; i < 3; i++) await rl.authEmailLimiter.checkKey("outage-key");
    expect(await statusOf(() => rl.authEmailLimiter.checkKey("outage-key"))).toBe(429);
    expect(await statusOf(() => rl.authEmailLimiter.checkKey("another-key"))).toBe(200);
  });

  it("uses the Upstash verdict when it answers", async () => {
    upstash.limit.mockResolvedValue({ success: true, reset: Date.now() + 1000 });
    expect(await statusOf(() => rl.playLimiter.check(request("10.1.0.2")))).toBe(200);

    upstash.limit.mockResolvedValue({ success: false, reset: Date.now() + 60_000 });
    expect(await statusOf(() => rl.playLimiter.check(request("10.1.0.2")))).toBe(429);
  });
});
