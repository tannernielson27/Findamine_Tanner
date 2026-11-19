import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Result = { data: unknown; error: unknown };

function query(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "update", "eq", "is"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getUserById: vi.fn(),
  consentRecord: null as unknown,
  from: vi.fn(),
  limiterCheck: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp: h.verifyOtp } }),
  createSupabaseServiceClient: async () => ({
    from: h.from,
    auth: { admin: { getUserById: h.getUserById } },
  }),
}));
vi.mock("@/lib/utils/rate-limit", () => ({ consentVerifyLimiter: { check: h.limiterCheck } }));

import { GET as confirm, POST as confirmPress } from "@/app/api/auth/confirm/route";
import { GET as verifyConsent } from "@/app/api/v1/consent/coppa/verify/route";
import { ApiError } from "@/lib/utils/api-auth";

const ORIGIN = "https://findamine.test";
const UID = "11111111-2222-3333-4444-555555555555";

function confirmRequest(params: Record<string, string>, userAgent?: string): Request {
  return new Request(`${ORIGIN}/api/auth/confirm?${new URLSearchParams(params).toString()}`, {
    headers: userAgent ? { "user-agent": userAgent } : {},
  });
}

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_APP =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FindamineApp/1";

function locationOf(res: Response): URL {
  return new URL(res.headers.get("location") ?? "");
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN);
  h.verifyOtp.mockReset();
  h.getUserById.mockReset();
  h.limiterCheck.mockReset().mockResolvedValue(undefined);
  h.from.mockReset().mockImplementation(() => query({ data: h.consentRecord, error: null }));
  h.consentRecord = null;
});

describe("GET /api/auth/confirm (opening the emailed link)", () => {
  it("does not spend a confirmation token: it hands the link to the confirm page", async () => {
    for (const type of ["signup", "magiclink"]) {
      const res = await confirm(
        confirmRequest({ token_hash: "tok", type, next: "/dashboard/join-class", uid: UID, app: "1" }, IPHONE_SAFARI)
      );
      const url = locationOf(res);
      expect(url.origin).toBe(ORIGIN);
      expect(url.pathname).toBe("/confirm-email");
      expect(Object.fromEntries(url.searchParams)).toEqual({
        token_hash: "tok",
        type,
        next: "/dashboard/join-class",
        uid: UID,
        app: "1",
      });
    }
    // What a mail scanner does (open the link, any user agent) changes nothing.
    await confirm(confirmRequest({ token_hash: "tok", type: "signup" }));
    expect(h.verifyOtp).not.toHaveBeenCalled();
    expect(h.getUserById).not.toHaveBeenCalled();
  });

  it("drops an off-site next and a malformed uid on the way to the confirm page", async () => {
    const res = await confirm(confirmRequest({ token_hash: "tok", type: "signup", next: "//evil.example", uid: "not-a-uuid" }));
    const url = locationOf(res);
    expect(url.pathname).toBe("/confirm-email");
    expect(url.searchParams.has("next")).toBe(false);
    expect(url.searchParams.has("uid")).toBe(false);
  });

  it("does not spend a password-reset token on the GET", async () => {
    const res = await confirm(confirmRequest({ token_hash: "tok-recovery", type: "recovery", next: "/reset-password" }));

    expect(h.verifyOtp).not.toHaveBeenCalled();
    expect(locationOf(res).pathname).toBe("/reset-password");
    expect(locationOf(res).searchParams.get("token_hash")).toBe("tok-recovery");
  });

  it("goes straight on inside the app (a universal link)", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });

    const res = await confirm(
      confirmRequest({ token_hash: "tok", type: "signup", next: "/dashboard", app: "1" }, IPHONE_APP)
    );

    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "tok", type: "signup" });
    expect(locationOf(res).pathname).toBe("/dashboard");
  });

  it("carries the app marker onto the reset page", async () => {
    const res = await confirm(confirmRequest({ token_hash: "tok", type: "recovery", app: "1" }, IPHONE_SAFARI));

    expect(locationOf(res).pathname).toBe("/reset-password");
    expect(locationOf(res).searchParams.get("app")).toBe("1");
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it("rejects a link with a missing token or unknown type", async () => {
    const res = await confirm(confirmRequest({ type: "invite", token_hash: "tok" }));

    expect(h.verifyOtp).not.toHaveBeenCalled();
    expect(locationOf(res).searchParams.get("error")).toBe("link_invalid");
  });
});

describe("POST /api/auth/confirm (pressing Confirm my email)", () => {
  function press(fields: Record<string, string>, headers: Record<string, string> = {}): NextRequest {
    return new NextRequest(`${ORIGIN}/api/auth/confirm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, ...headers },
      body: new URLSearchParams(fields).toString(),
    });
  }

  it("signs the user in and honors a same-origin next path", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });

    const res = await confirmPress(press({ token_hash: "tok", type: "signup", next: "/dashboard/join-class" }));

    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: "tok", type: "signup" });
    // 303, so the browser follows the form post with a GET.
    expect(res.status).toBe(303);
    expect(locationOf(res).pathname).toBe("/dashboard/join-class");
  });

  it("never follows an off-site next", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });

    const res = await confirmPress(press({ token_hash: "tok", type: "signup", next: "//evil.example" }));

    expect(locationOf(res).origin).toBe(ORIGIN);
    expect(locationOf(res).pathname).toBe("/dashboard");
  });

  it("says 'confirmed, please sign in' when the token was already used (e.g. the emailed code)", async () => {
    h.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "Email link is invalid or has expired" } });
    h.getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-10-01T00:00:00Z" } }, error: null });

    const res = await confirmPress(press({ token_hash: "tok", type: "signup", next: "/dashboard", uid: UID }));

    expect(h.getUserById).toHaveBeenCalledWith(UID);
    const url = locationOf(res);
    expect(res.status).toBe(303);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("notice")).toBe("confirmed");
    expect(url.searchParams.get("error")).toBeNull();
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("offers a resend when the link is dead and the account is still unconfirmed", async () => {
    h.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "expired" } });
    h.getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: null } }, error: null });

    const res = await confirmPress(press({ token_hash: "tok", type: "magiclink", uid: UID }));

    expect(locationOf(res).pathname).toBe("/login");
    expect(locationOf(res).searchParams.get("error")).toBe("confirm_link_invalid");
  });

  it("does not look anyone up for a link without a well-formed uid", async () => {
    h.verifyOtp.mockResolvedValue({ error: { code: "otp_expired", message: "expired" } });

    const res = await confirmPress(press({ token_hash: "tok", type: "signup", uid: "not-a-uuid" }));

    expect(h.getUserById).not.toHaveBeenCalled();
    expect(locationOf(res).searchParams.get("error")).toBe("confirm_link_invalid");
  });

  it("tells a phone browser to go back to the app when the link was asked for in the app", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });

    const res = await confirmPress(
      press({ token_hash: "tok", type: "signup", next: "/dashboard/join-class", app: "1" }, { "user-agent": IPHONE_SAFARI })
    );

    expect(locationOf(res).pathname).toBe("/email-confirmed");
    expect(locationOf(res).searchParams.get("continue")).toBe("/dashboard/join-class");
  });

  it("leaves a phone browser alone when the link was asked for on the web", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });

    const res = await confirmPress(press({ token_hash: "tok", type: "signup", next: "/dashboard" }, { "user-agent": IPHONE_SAFARI }));

    expect(locationOf(res).pathname).toBe("/dashboard");
  });

  it("sends a phone browser on an already-used link to the landing page, then to sign in", async () => {
    h.verifyOtp.mockResolvedValue({ error: { message: "Email link is invalid or has expired" } });
    h.getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-09-15T00:00:00Z" } } });

    const res = await confirmPress(
      press({ token_hash: "tok", type: "signup", next: "/dashboard", uid: UID, app: "1" }, { "user-agent": IPHONE_SAFARI })
    );

    expect(locationOf(res).pathname).toBe("/email-confirmed");
    const continueTo = new URL(locationOf(res).searchParams.get("continue") ?? "", ORIGIN);
    expect(continueTo.pathname).toBe("/login");
    expect(continueTo.searchParams.get("notice")).toBe("confirmed");
    expect(continueTo.searchParams.get("next")).toBe("/dashboard");
  });

  it("decides where a post came from by Origin, then Sec-Fetch-Site, then Referer, and refuses one with none", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });
    const bare = (headers: Record<string, string>) =>
      new NextRequest(`${ORIGIN}/api/auth/confirm`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
        body: new URLSearchParams({ token_hash: "tok", type: "signup" }).toString(),
      });
    const outcome = async (headers: Record<string, string>) => {
      const url = locationOf(await confirmPress(bare(headers)));
      return url.searchParams.get("error") ?? url.pathname;
    };

    expect(await outcome({ "sec-fetch-site": "same-origin" })).toBe("/dashboard");
    expect(await outcome({ referer: `${ORIGIN}/confirm-email?token_hash=tok` })).toBe("/dashboard");
    expect(await outcome({ "sec-fetch-site": "cross-site" })).toBe("link_invalid");
    expect(await outcome({ "sec-fetch-site": "none" })).toBe("link_invalid");
    expect(await outcome({ referer: "https://evil.example/form" })).toBe("link_invalid");
    expect(await outcome({ referer: "not a url" })).toBe("link_invalid");
    expect(await outcome({})).toBe("link_invalid");
    // A cross-site Origin loses even with a friendly-looking Referer.
    expect(await outcome({ origin: "https://evil.example", referer: `${ORIGIN}/confirm-email` })).toBe("link_invalid");
    expect(h.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it("sends the person back to sign in, not to an error page, when the auth service can't be reached", async () => {
    h.verifyOtp.mockRejectedValue(new Error("fetch failed"));

    const res = await confirmPress(press({ token_hash: "tok", type: "signup", next: "/dashboard", uid: UID }));

    expect(res.status).toBe(303);
    expect(locationOf(res).pathname).toBe("/login");
    expect(locationOf(res).searchParams.get("error")).toBe("confirm_link_invalid");
    expect(h.getUserById).not.toHaveBeenCalled();
  });

  it("refuses a form posted from another site, a reset token, and a malformed form", async () => {
    const refused = [
      press({ token_hash: "tok", type: "signup" }, { origin: "https://evil.example" }),
      press({ token_hash: "tok", type: "recovery" }),
      press({ type: "signup" }),
      press({ token_hash: "tok", type: "invite" }),
    ];
    for (const request of refused) {
      const res = await confirmPress(request);
      expect(res.status).toBe(303);
      expect(locationOf(res).pathname).toBe("/login");
      expect(locationOf(res).searchParams.get("error")).toBe("link_invalid");
    }
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/consent/coppa/verify", () => {
  function consentRequest(params: Record<string, string>): NextRequest {
    return new NextRequest(`${ORIGIN}/api/v1/consent/coppa/verify?${new URLSearchParams(params).toString()}`);
  }

  it("sends an invalid or expired link to a readable page, not JSON", async () => {
    h.consentRecord = null;

    const res = await verifyConsent(consentRequest({ token: "wrong", child_id: "c1" }));

    expect(res.status).toBe(302);
    expect(res.headers.get("content-type")).toBeNull();
    expect(locationOf(res).pathname).toBe("/consent-verified");
    expect(locationOf(res).searchParams.get("error")).toBe("invalid");
  });

  it("treats a link with missing parameters the same way", async () => {
    const res = await verifyConsent(consentRequest({ token: "only-token" }));

    expect(locationOf(res).searchParams.get("error")).toBe("invalid");
    expect(h.from).not.toHaveBeenCalled();
  });

  it("redirects on rate limiting and unexpected failures too", async () => {
    h.limiterCheck.mockRejectedValueOnce(new ApiError(429, "Too many attempts."));
    const limited = await verifyConsent(consentRequest({ token: "t", child_id: "c1" }));
    expect(locationOf(limited).searchParams.get("error")).toBe("rate_limited");

    h.from.mockImplementationOnce(() => {
      throw new Error("db down");
    });
    const failed = await verifyConsent(consentRequest({ token: "t", child_id: "c1" }));
    expect(locationOf(failed).searchParams.get("error")).toBe("failed");
  });

  it("still activates the child for a valid link", async () => {
    h.consentRecord = { id: "consent-1", user_id: "parent-1", granted: false, verified_at: null };

    const res = await verifyConsent(consentRequest({ token: "good", child_id: "c1" }));

    expect(locationOf(res).searchParams.get("success")).toBe("true");
    expect(h.from.mock.calls.map((call) => call[0])).toEqual([
      "consent_records",
      "consent_records",
      "parent_child_links",
      "users",
    ]);
  });

  it("reports an already-verified link as such", async () => {
    h.consentRecord = { id: "consent-1", user_id: "parent-1", granted: true, verified_at: "2026-10-01T00:00:00Z" };

    const res = await verifyConsent(consentRequest({ token: "good", child_id: "c1" }));

    expect(locationOf(res).searchParams.get("already")).toBe("true");
  });
});
