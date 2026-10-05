import { describe, it, expect, afterEach, vi } from "vitest";
import {
  buildAuthConfirmUrl,
  escapeHtml,
  isAuthLinkType,
  resolveSiteUrl,
  safeNextPath,
} from "@/lib/services/auth-emails";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeNextPath", () => {
  it("keeps same-site relative paths", () => {
    expect(safeNextPath("/reset-password", "/dashboard")).toBe("/reset-password");
    expect(safeNextPath("/hunts/abc?tab=map", "/dashboard")).toBe("/hunts/abc?tab=map");
  });

  it("falls back for missing, absolute, protocol-relative and backslash paths", () => {
    expect(safeNextPath(null, "/dashboard")).toBe("/dashboard");
    expect(safeNextPath("", "/dashboard")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNextPath("//evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example", "/dashboard")).toBe("/dashboard");
    // Browsers strip tabs/newlines while parsing, which would leave "//evil.example".
    expect(safeNextPath("/\t/evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/\n/evil.example", "/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/a b", "/dashboard")).toBe("/dashboard");
  });
});

describe("isAuthLinkType", () => {
  it("accepts only the link types the app emails", () => {
    expect(isAuthLinkType("signup")).toBe(true);
    expect(isAuthLinkType("magiclink")).toBe(true);
    expect(isAuthLinkType("recovery")).toBe(true);
    expect(isAuthLinkType("invite")).toBe(false);
    expect(isAuthLinkType("email_change")).toBe(false);
    expect(isAuthLinkType(null)).toBe(false);
  });
});

describe("buildAuthConfirmUrl", () => {
  it("adds the account id only when one is given", () => {
    const withUid = new URL(buildAuthConfirmUrl("https://findamine.test", "abc", "signup", "/dashboard", "auth-1"));
    expect(withUid.searchParams.get("uid")).toBe("auth-1");
    const without = new URL(buildAuthConfirmUrl("https://findamine.test", "abc", "signup", "/dashboard"));
    expect(without.searchParams.has("uid")).toBe(false);
  });

  it("points at the confirm route with encoded parameters", () => {
    const url = new URL(buildAuthConfirmUrl("https://findamine.test", "abc+/=", "recovery", "/reset-password"));
    expect(url.origin + url.pathname).toBe("https://findamine.test/api/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("abc+/=");
    expect(url.searchParams.get("type")).toBe("recovery");
    expect(url.searchParams.get("next")).toBe("/reset-password");
  });
});

describe("resolveSiteUrl", () => {
  it("prefers NEXT_PUBLIC_SITE_URL without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://findamine.test/");
    expect(resolveSiteUrl("https://spoofed.example")).toBe("https://findamine.test");
  });

  it("uses the request origin outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(resolveSiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("refuses to trust the request origin in production", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => resolveSiteUrl("https://spoofed.example")).toThrow(/NEXT_PUBLIC_SITE_URL/);
  });
});

describe("escapeHtml", () => {
  it("neutralises markup in user-supplied names", () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe(
      "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;"
    );
  });
});
