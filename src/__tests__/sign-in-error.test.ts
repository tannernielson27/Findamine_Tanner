import { describe, expect, it } from "vitest";
import { signInFailure } from "@/lib/utils/sign-in-error";

describe("signInFailure", () => {
  it("keeps wrong credentials as 401 invalid email or password", () => {
    const e = signInFailure({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" });
    expect(e.statusCode).toBe(401);
    expect(e.message).toBe("Invalid email or password");
  });

  it("reports Supabase rate limiting as 429, not a wrong password", () => {
    const e = signInFailure({ status: 429, code: "over_request_rate_limit", message: "Request rate limit reached" });
    expect(e.statusCode).toBe(429);
    expect(e.message).toMatch(/too many attempts/i);
  });

  it("detects rate limiting by code even without a status", () => {
    expect(signInFailure({ code: "over_request_rate_limit" }).statusCode).toBe(429);
  });

  it("reports an overloaded or timed-out auth server as 503", () => {
    const e = signInFailure({ status: 504, message: "context deadline exceeded" });
    expect(e.statusCode).toBe(503);
    expect(e.message).toMatch(/try again/i);
  });

  it("reports a network failure reaching auth as 503", () => {
    expect(signInFailure({ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }).statusCode).toBe(503);
  });

  it("keeps an unconfirmed email distinguishable", () => {
    const e = signInFailure({ status: 400, code: "email_not_confirmed", message: "Email not confirmed" });
    expect(e.statusCode).toBe(403);
    expect(e.message).toMatch(/confirm your email/i);
  });

  it("reports a banned account as 403", () => {
    expect(signInFailure({ status: 400, code: "user_banned" }).statusCode).toBe(403);
  });
});
