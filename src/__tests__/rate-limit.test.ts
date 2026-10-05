import { describe, it, expect, vi, beforeAll } from "vitest";
import { NextRequest } from "next/server";

type RateLimitModule = typeof import("@/lib/utils/rate-limit");
let rl: RateLimitModule;

beforeAll(async () => {
  // Force the in-memory limiter: nothing here may reach a real Redis.
  for (const name of [
    "UPSTASH_REDIS_KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_TOKEN",
  ]) {
    vi.stubEnv(name, "");
  }
  vi.resetModules();
  rl = await import("@/lib/utils/rate-limit");
});

const CAMPUS_IP = "128.187.0.1";

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** A Supabase-shaped access token; every real one shares the same header. */
function accessToken(sub: string): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ sub, role: "authenticated" })}.signature`;
}

/** The cookie value @supabase/ssr stores: "base64-" + base64url(session JSON). */
function sessionCookie(sub: string): string {
  return `base64-${b64url({ access_token: accessToken(sub), refresh_token: "r", token_type: "bearer" })}`;
}

function request(opts: { ip?: string; cookies?: Record<string, string>; bearer?: string } = {}): NextRequest {
  const headers = new Headers({ "x-forwarded-for": opts.ip ?? CAMPUS_IP });
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  if (opts.cookies) {
    headers.set(
      "cookie",
      Object.entries(opts.cookies).map(([name, value]) => `${name}=${value}`).join("; ")
    );
  }
  return new NextRequest("http://localhost:3000/api/v1/anything", { method: "POST", headers });
}

async function statusOf(run: () => Promise<void>): Promise<number> {
  try {
    await run();
    return 200;
  } catch (error) {
    return (error as { statusCode?: number }).statusCode ?? 500;
  }
}

describe("getCompositeKey", () => {
  it("is IP-only for an unauthenticated request", () => {
    expect(rl.getCompositeKey(request())).toBe(CAMPUS_IP);
  });

  it("gives two signed-in students on one IP different keys (the real @supabase/ssr cookie)", () => {
    const ana = rl.getCompositeKey(request({ cookies: { "sb-abcdefghijkl-auth-token": sessionCookie("user-ana") } }));
    const ben = rl.getCompositeKey(request({ cookies: { "sb-abcdefghijkl-auth-token": sessionCookie("user-ben") } }));

    expect(ana).toBe(`user-ana:${CAMPUS_IP}`);
    expect(ben).toBe(`user-ben:${CAMPUS_IP}`);
  });

  it("joins a session cookie that was split into chunks", () => {
    const value = sessionCookie("user-chunked");
    const cut = Math.floor(value.length / 2);
    const key = rl.getCompositeKey(
      request({
        cookies: {
          // Deliberately out of order: chunks must be sorted by index.
          "sb-abcdefghijkl-auth-token.1": value.slice(cut),
          "sb-abcdefghijkl-auth-token.0": value.slice(0, cut),
        },
      })
    );
    expect(key).toBe(`user-chunked:${CAMPUS_IP}`);
  });

  it("separates bearer tokens even though they all start with the same characters", () => {
    const ana = rl.getCompositeKey(request({ bearer: accessToken("user-ana") }));
    const ben = rl.getCompositeKey(request({ bearer: accessToken("user-ben") }));
    expect(ana).toBe(`user-ana:${CAMPUS_IP}`);
    expect(ben).not.toBe(ana);
  });

  it("still tells sessions apart when the cookie cannot be decoded", () => {
    const a = rl.getCompositeKey(request({ cookies: { "sb-abcdefghijkl-auth-token": "garbage-one" } }));
    const b = rl.getCompositeKey(request({ cookies: { "sb-abcdefghijkl-auth-token": "garbage-two" } }));
    expect(a).not.toBe(b);
    expect(a.endsWith(`:${CAMPUS_IP}`)).toBe(true);
  });
});

describe("auth limits for a class signing up from one campus IP", () => {
  it("lets a 100-person lecture hall register, retries included", async () => {
    for (let i = 0; i < 300; i++) {
      await rl.registerIpLimiter.check(request({ ip: "10.0.0.1" }));
    }
    expect(await statusOf(() => rl.registerIpLimiter.check(request({ ip: "10.0.0.1" })))).toBe(429);
    // A different network is unaffected.
    expect(await statusOf(() => rl.registerIpLimiter.check(request({ ip: "10.0.0.2" })))).toBe(200);
  });

  it("does not let a made-up Authorization header dodge a per-IP limit", async () => {
    for (let i = 0; i < 300; i++) {
      await rl.loginIpLimiter.check(request({ ip: "10.0.1.1", bearer: accessToken(`fake-${i}`) }));
    }
    const status = await statusOf(() =>
      rl.loginIpLimiter.check(request({ ip: "10.0.1.1", bearer: accessToken("fake-new") }))
    );
    expect(status).toBe(429);
  });

  it("limits auth emails per address, not per IP", async () => {
    const victim = `resend:${rl.emailRateLimitKey(" Victim@BYU.edu ")}`;
    for (let i = 0; i < 3; i++) await rl.authEmailLimiter.checkKey(victim);

    expect(await statusOf(() => rl.authEmailLimiter.checkKey(`resend:${rl.emailRateLimitKey("victim@byu.edu")}`))).toBe(429);
    // A classmate, and a different kind of email to the same address, are separate.
    expect(await statusOf(() => rl.authEmailLimiter.checkKey(`resend:${rl.emailRateLimitKey("classmate@byu.edu")}`))).toBe(200);
    expect(await statusOf(() => rl.authEmailLimiter.checkKey(`recovery:${rl.emailRateLimitKey("victim@byu.edu")}`))).toBe(200);
  });

  it("does not store the address itself in the limiter key", () => {
    expect(rl.emailRateLimitKey("victim@byu.edu")).not.toContain("victim");
  });

  it("explains a 429 in human terms", async () => {
    for (let i = 0; i < 3; i++) await rl.authEmailLimiter.checkKey("human-message");
    const error = await rl.authEmailLimiter.checkKey("human-message").catch((e: Error) => e);
    expect((error as Error).message).toBe("Too many attempts. Please try again in about 15 minutes.");
  });
});

describe("formatRetryAfter", () => {
  it("rounds to something a person would say", () => {
    expect(rl.formatRetryAfter(5)).toBe("a few seconds");
    expect(rl.formatRetryAfter(60)).toBe("about a minute");
    expect(rl.formatRetryAfter(847)).toBe("about 15 minutes");
    expect(rl.formatRetryAfter(3 * 3600)).toBe("about 3 hours");
  });
});
