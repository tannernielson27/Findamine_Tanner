import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const h = vi.hoisted(() => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: h.sendEmail }));

import { isAppUserAgent, isPhoneBrowserOutsideApp } from "@/lib/native/user-agent";
import { appleAppSiteAssociation, IOS_APP_ID } from "@/lib/native/universal-links";
import { APP_HOSTS } from "@/lib/native/app-hosts";
import { cleanEmailCode, describeEmailCodeError } from "@/app/login/auth-client";
import {
  displayableEmailCode,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from "@/lib/services/auth-emails";
import { GET as aasa } from "@/app/.well-known/apple-app-site-association/route";

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FindamineApp/1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";

function htmlSent(): string {
  return (h.sendEmail.mock.calls[0][0] as { html: string }).html;
}

beforeEach(() => {
  h.sendEmail.mockReset().mockResolvedValue({ success: true, id: "em_1" });
});

describe("phone browser detection", () => {
  it("recognizes the app's own web view", () => {
    expect(isAppUserAgent(IPHONE_APP)).toBe(true);
    expect(isAppUserAgent(IPHONE_SAFARI)).toBe(false);
    expect(isAppUserAgent(null)).toBe(false);
  });

  it("flags iPhone Safari and Android Chrome, never the app or a desktop", () => {
    expect(isPhoneBrowserOutsideApp(IPHONE_SAFARI)).toBe(true);
    expect(isPhoneBrowserOutsideApp(ANDROID_CHROME)).toBe(true);
    expect(isPhoneBrowserOutsideApp(IPHONE_APP)).toBe(false);
    expect(isPhoneBrowserOutsideApp(MAC_SAFARI)).toBe(false);
    expect(isPhoneBrowserOutsideApp("")).toBe(false);
  });

  it("catches iPadOS Safari, which reports itself as a Mac, by its touch points", () => {
    expect(isPhoneBrowserOutsideApp(MAC_SAFARI, 5)).toBe(true);
  });
});

describe("universal links", () => {
  it("opens the emailed confirm links and pages in the app, but not other API routes", () => {
    const [detail] = appleAppSiteAssociation().applinks.details;
    expect(detail.appIDs).toEqual(["54LWQR937V.app.findamine"]);
    const paths = detail.components.map((c) => [c["/"], c.exclude === true]);
    expect(paths).toEqual([
      ["/api/auth/confirm", false],
      ["/api/*", true],
      ["/*", false],
    ]);
  });

  it("serves the association file as JSON", async () => {
    const res = aasa();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual(appleAppSiteAssociation());
  });

  it("declares the app hosts that serve the file (not the redirecting www) as associated domains", () => {
    const entitlements = readFileSync(join(process.cwd(), "ios/App/App/App.entitlements"), "utf8");
    const domains = [...entitlements.matchAll(/<string>applinks:([^<]+)<\/string>/g)].map((m) => m[1]);
    expect(domains.sort()).toEqual(["findamine-tanner.vercel.app", "findamine.app"]);
    for (const domain of domains) expect(APP_HOSTS).toContain(domain);
    expect(IOS_APP_ID.endsWith(".app.findamine")).toBe(true);
  });
});

describe("emailed codes", () => {
  it("shows only well-formed numeric codes", () => {
    expect(displayableEmailCode("123456")).toBe("123456");
    expect(displayableEmailCode(" 12345678 ")).toBe("12345678");
    expect(displayableEmailCode("12ab56")).toBeNull();
    expect(displayableEmailCode("<b>1</b>")).toBeNull();
    expect(displayableEmailCode(undefined)).toBeNull();
  });

  it("puts the code in the confirmation email next to the link", async () => {
    await sendVerificationEmail({ to: "a@byu.edu", displayName: "Ana", confirmUrl: "https://x.test/c", code: "482913" });
    const html = htmlSent();
    expect(html).toContain("482913");
    expect(html).toContain("findamine app");
    expect(html).toContain('href="https://x.test/c"');
  });

  it("puts the code in the password reset email", async () => {
    await sendPasswordResetEmail({ to: "a@byu.edu", confirmUrl: "https://x.test/r", code: "771204" });
    expect(htmlSent()).toContain("771204");
  });

  it("still sends a link-only email when there is no usable code", async () => {
    await sendVerificationEmail({ to: "a@byu.edu", displayName: null, confirmUrl: "https://x.test/c", code: null });
    const html = htmlSent();
    expect(html).not.toContain("Enter this code");
    expect(html).toContain("This link works once");
  });

  it("cleans pasted codes down to digits", () => {
    expect(cleanEmailCode("123 456")).toBe("123456");
    expect(cleanEmailCode("Code: 98-76-54")).toBe("987654");
    expect(cleanEmailCode("12345678901234")).toBe("1234567890");
  });

  it("explains a rejected code without saying which part was wrong", () => {
    expect(describeEmailCodeError({ code: "otp_expired", status: 403 })).toMatch(/wrong or has expired/);
    expect(describeEmailCodeError({ status: 429 })).toMatch(/Too many attempts/);
    expect(describeEmailCodeError({ name: "AuthRetryableFetchError" })).toMatch(/Couldn't reach the server/);
  });
});
