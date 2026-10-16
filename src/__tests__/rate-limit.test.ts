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

describe("per-user limits (M9: keys never come from unverified cookies or tokens)", () => {
  it("reads the IP from the edge's x-forwarded-for, first hop", () => {
    const r = new NextRequest("http://localhost:3000/x", { headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } });
    expect(rl.getClientIp(r)).toBe("1.2.3.4");
    const fallback = new NextRequest("http://localhost:3000/x", { headers: { "x-real-ip": "5.6.7.8" } });
    expect(rl.getClientIp(fallback)).toBe("5.6.7.8");
  });

  it("limits a verified user at the limiter's own max", async () => {
    for (let i = 0; i < 10; i++) await rl.authLimiter.check(request({ ip: "10.2.0.1" }), "user-ana");
    expect(await statusOf(() => rl.authLimiter.check(request({ ip: "10.2.0.1" }), "user-ana"))).toBe(429);
  });

  it("gives two signed-in students on one campus IP separate buckets", async () => {
    for (let i = 0; i < 10; i++) await rl.authLimiter.check(request({ ip: "10.2.0.2" }), "user-ben");
    expect(await statusOf(() => rl.authLimiter.check(request({ ip: "10.2.0.2" }), "user-cal"))).toBe(200);
  });

  it("follows the user across IPs (a new network is not a new bucket)", async () => {
    for (let i = 0; i < 10; i++) await rl.authLimiter.check(request({ ip: `10.3.0.${i}` }), "user-dee");
    expect(await statusOf(() => rl.authLimiter.check(request({ ip: "10.3.1.1" }), "user-dee"))).toBe(429);
  });

  it("ignores junk sb-*-auth-token cookies: they never mint a fresh bucket", async () => {
    // Without a verified user the only key is the IP, so a new cookie per
    // request changes nothing. 10 * 30 = the per-IP ceiling for authLimiter.
    for (let i = 0; i < 300; i++) {
      await rl.authLimiter.check(request({ ip: "10.4.0.1", cookies: { [`sb-x${i}-auth-token`]: `junk-${i}` } }));
    }
    const status = await statusOf(() =>
      rl.authLimiter.check(request({ ip: "10.4.0.1", cookies: { "sb-new-auth-token": sessionCookie("someone-else") } }))
    );
    expect(status).toBe(429);
  });

  it("ignores made-up bearer tokens too", async () => {
    for (let i = 0; i < 300; i++) {
      await rl.authLimiter.check(request({ ip: "10.5.0.1", bearer: accessToken(`fake-${i}`) }));
    }
    expect(await statusOf(() => rl.authLimiter.check(request({ ip: "10.5.0.1", bearer: accessToken("fresh") })))).toBe(429);
  });

  it("caps a whole IP even when every request names a different (verified) user", async () => {
    for (let i = 0; i < 300; i++) await rl.authLimiter.check(request({ ip: "10.6.0.1" }), `student-${i}`);
    expect(await statusOf(() => rl.authLimiter.check(request({ ip: "10.6.0.1" }), "student-new"))).toBe(429);
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
