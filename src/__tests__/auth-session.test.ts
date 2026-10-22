import { describe, it, expect } from "vitest";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  SIGNED_IN_HOME,
  authCookieOptions,
  isHttpsRequest,
  launchRedirect,
} from "@/lib/auth/session";

describe("authCookieOptions", () => {
  it("is persistent (has a long max-age), so iOS keeps it when the web view is killed", () => {
    const opts = authCookieOptions(true);
    expect(opts.maxAge).toBe(AUTH_COOKIE_MAX_AGE_SECONDS);
    expect(opts.maxAge).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
  });

  it("is site-wide and sameSite=lax", () => {
    const opts = authCookieOptions(true);
    expect(opts.path).toBe("/");
    expect(opts.sameSite).toBe("lax");
  });

  it("is secure on https and not on plain http (local dev)", () => {
    expect(authCookieOptions(true).secure).toBe(true);
    expect(authCookieOptions(false).secure).toBe(false);
  });

  it("returns a fresh object each call", () => {
    expect(authCookieOptions(true)).not.toBe(authCookieOptions(true));
  });
});

describe("isHttpsRequest", () => {
  it("trusts the first x-forwarded-proto entry", () => {
    expect(isHttpsRequest("https")).toBe(true);
    expect(isHttpsRequest("https, http")).toBe(true);
    expect(isHttpsRequest(" HTTPS ")).toBe(true);
    expect(isHttpsRequest("http", "https:")).toBe(false);
  });

  it("falls back to the URL protocol when the header is missing", () => {
    expect(isHttpsRequest(null, "https:")).toBe(true);
    expect(isHttpsRequest(undefined, "http:")).toBe(false);
    expect(isHttpsRequest("", "https:")).toBe(true);
    expect(isHttpsRequest(null)).toBe(false);
  });
});

describe("launchRedirect", () => {
  it("sends a signed-in visitor to / straight into the app", () => {
    expect(launchRedirect("/", true)).toBe(SIGNED_IN_HOME);
    expect(SIGNED_IN_HOME).toBe("/dashboard");
  });

  it("keeps a signed-out visitor on the welcome screen", () => {
    expect(launchRedirect("/", false)).toBeNull();
  });

  it("never redirects other paths", () => {
    expect(launchRedirect("/browse", true)).toBeNull();
    expect(launchRedirect("/privacy", true)).toBeNull();
    expect(launchRedirect("/dashboard", true)).toBeNull();
    expect(launchRedirect("//", true)).toBeNull();
  });
});
