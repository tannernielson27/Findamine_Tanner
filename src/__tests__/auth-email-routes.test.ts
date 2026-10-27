import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Result = { data: unknown; error: unknown };

/** A chainable stand-in for one PostgREST query that resolves to `result`. */
function query(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "delete", "upsert", "eq", "is", "ilike", "order", "limit"]) q[m] = vi.fn(() => q);
  q.single = vi.fn(async () => result);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

const h = vi.hoisted(() => ({
  service: null as unknown as {
    from: ReturnType<typeof vi.fn>;
    auth: { admin: Record<string, ReturnType<typeof vi.fn>> };
  },
  sendVerificationEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  enrollParticipant: vi.fn(),
  redeemReferral: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => h.service,
}));
vi.mock("@/lib/utils/rate-limit", () => {
  const limiter = { check: async () => {}, checkKey: async () => {} };
  return {
    authLimiter: limiter,
    registerIpLimiter: limiter,
    registerEmailLimiter: limiter,
    authEmailIpLimiter: limiter,
    authEmailLimiter: limiter,
    emailRateLimitKey: (email: string) => email,
  };
});
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/track-event", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/services/enrollment", () => ({ enrollParticipant: h.enrollParticipant }));
vi.mock("@/lib/services/referral", () => ({ redeemReferral: h.redeemReferral }));
vi.mock("@/lib/services/auth-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/auth-emails")>()),
  sendVerificationEmail: h.sendVerificationEmail,
  sendPasswordResetEmail: h.sendPasswordResetEmail,
}));

import { POST as register } from "@/app/api/v1/auth/register/route";
import { POST as forgotPassword } from "@/app/api/v1/auth/forgot-password/route";
import { POST as resendVerification } from "@/app/api/v1/auth/resend-verification/route";

function post(path: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * `tables` maps a table to the result of every query on it, or to a list of
 * results handed out in call order (the last one repeats).
 */
function install(tables: Record<string, Result | Result[]> = {}) {
  const queries: Record<string, ReturnType<typeof query>[]> = {};
  h.service = {
    from: vi.fn((table: string) => {
      const configured = tables[table] ?? { data: null, error: null };
      const index = queries[table]?.length ?? 0;
      const result = Array.isArray(configured)
        ? configured[Math.min(index, configured.length - 1)]
        : configured;
      const q = query(result);
      (queries[table] ||= []).push(q);
      return q;
    }),
    auth: {
      admin: {
        generateLink: vi.fn(),
        deleteUser: vi.fn(async () => ({ error: null })),
        getUserById: vi.fn(),
      },
    },
  };
  return queries;
}

function confirmUrlOf(mock: ReturnType<typeof vi.fn>): URL {
  return new URL((mock.mock.calls[0][0] as { confirmUrl: string }).confirmUrl);
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://findamine.test");
  h.sendVerificationEmail.mockReset().mockResolvedValue({ success: true, id: "em_1" });
  h.sendPasswordResetEmail.mockReset().mockResolvedValue({ success: true, id: "em_2" });
  h.enrollParticipant.mockReset();
  h.redeemReferral.mockReset().mockResolvedValue({ ok: true });
});

const NO_PROFILE: Result = { data: null, error: null };
/** generateLink result for an auth user this request just created. */
function freshLink(token: string) {
  return {
    data: { user: { id: "auth-1", created_at: new Date().toISOString() }, properties: { hashed_token: token } },
    error: null,
  };
}
/** generateLink result for an address that signed up earlier and never confirmed. */
function existingUnconfirmedLink(token: string) {
  return {
    data: { user: { id: "auth-1", created_at: "2026-09-01T00:00:00Z" }, properties: { hashed_token: token } },
    error: null,
  };
}

const ADULT = { email: "a@byu.edu", password: "long-enough-1", display_name: "Ana", role: "adult", age_confirmed: true };

describe("POST /api/v1/auth/register", () => {
  it("creates the account through a signup link and emails the confirmation", async () => {
    install({ users: [NO_PROFILE, { data: { id: "u1", email: ADULT.email, display_name: "Ana", role: "adult" }, error: null }] });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok-signup"));

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(201);
    expect(h.service.auth.admin.generateLink).toHaveBeenCalledWith({ type: "signup", email: ADULT.email, password: ADULT.password });
    const url = confirmUrlOf(h.sendVerificationEmail);
    expect(url.origin).toBe("https://findamine.test");
    expect(url.searchParams.get("token_hash")).toBe("tok-signup");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.get("uid")).toBe("auth-1");
    expect(h.enrollParticipant).toHaveBeenCalledWith("u1");
  });

  it("normalizes the email before creating, storing and mailing", async () => {
    const queries = install({ users: [NO_PROFILE, { data: { id: "u1", email: "a@byu.edu" }, error: null }] });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok"));

    const res = await register(post("/api/v1/auth/register", { ...ADULT, email: "  A@BYU.edu " }));

    expect(res.status).toBe(201);
    expect(h.service.auth.admin.generateLink).toHaveBeenCalledWith({ type: "signup", email: "a@byu.edu", password: ADULT.password });
    const inserted = (queries.users[1].insert as ReturnType<typeof vi.fn>).mock.calls[0][0] as { email: string };
    expect(inserted.email).toBe("a@byu.edu");
    expect((h.sendVerificationEmail.mock.calls[0][0] as { to: string }).to).toBe("a@byu.edu");
  });

  it("re-sends the link for an existing unconfirmed account and never deletes it", async () => {
    const queries = install({ users: { data: { id: "u-old", display_name: "Ana", deleted_at: null }, error: null } });
    h.service.auth.admin.generateLink.mockResolvedValue(existingUnconfirmedLink("tok-fresh"));

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resent: true });
    expect(confirmUrlOf(h.sendVerificationEmail).searchParams.get("token_hash")).toBe("tok-fresh");
    expect(h.service.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(queries.users.some((q) => (q.insert as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(false);
    expect(queries.users.some((q) => (q.delete as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(false);
    expect(h.enrollParticipant).not.toHaveBeenCalled();
  });

  it("treats a lost insert race as the existing account instead of deleting the winner", async () => {
    install({
      users: [
        NO_PROFILE,
        { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
        { data: { id: "u-winner", display_name: "Ana", deleted_at: null }, error: null },
      ],
    });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok-second"));

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resent: true });
    expect(h.service.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("never deletes an auth user it did not create when the profile insert fails", async () => {
    install({
      users: [NO_PROFILE, { data: null, error: { code: "23505", message: "duplicate key" } }, NO_PROFILE],
    });
    h.service.auth.admin.generateLink.mockResolvedValue(existingUnconfirmedLink("tok"));

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(409);
    expect(h.service.auth.admin.deleteUser).not.toHaveBeenCalled();
    expect(h.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it("rolls back an auth user it created when the profile insert fails outright", async () => {
    install({
      users: [NO_PROFILE, { data: null, error: { code: "XX000", message: "boom" } }, NO_PROFILE],
    });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok"));

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/profile/i);
    expect(h.service.auth.admin.deleteUser).toHaveBeenCalledWith("auth-1");
  });

  it("reports an unrecognized referral code without failing registration", async () => {
    install({ users: [NO_PROFILE, { data: { id: "u1", email: ADULT.email }, error: null }] });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok"));
    h.redeemReferral.mockResolvedValue({ ok: false, reason: "invalid_code" });

    const res = await register(post("/api/v1/auth/register", { ...ADULT, referral_code: "NOPE1234" }));

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ referral_applied: false });
    expect(h.redeemReferral).toHaveBeenCalledWith("u1", "NOPE1234");
  });

  it("only carries a same-origin return path into the confirmation link", async () => {
    install({ users: [NO_PROFILE, { data: { id: "u1", email: ADULT.email }, error: null }] });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok"));
    await register(post("/api/v1/auth/register", { ...ADULT, next: "/dashboard/join-class" }));
    expect(confirmUrlOf(h.sendVerificationEmail).searchParams.get("next")).toBe("/dashboard/join-class");

    h.sendVerificationEmail.mockClear();
    install({ users: [NO_PROFILE, { data: { id: "u1", email: ADULT.email }, error: null }] });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok"));
    await register(post("/api/v1/auth/register", { ...ADULT, next: "https://evil.example" }));
    expect(confirmUrlOf(h.sendVerificationEmail).searchParams.get("next")).toBe("/dashboard");
  });

  it("rolls the account back when the confirmation email cannot be sent", async () => {
    const queries = install({ users: [NO_PROFILE, { data: { id: "u1", email: ADULT.email }, error: null }] });
    h.service.auth.admin.generateLink.mockResolvedValue(freshLink("tok"));
    h.sendVerificationEmail.mockResolvedValue({ success: false, error: "domain not verified" });

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(503);
    expect(h.service.auth.admin.deleteUser).toHaveBeenCalledWith("auth-1");
    expect(queries.users.some((q) => (q.delete as ReturnType<typeof vi.fn>).mock.calls.length > 0)).toBe(true);
    expect(h.enrollParticipant).not.toHaveBeenCalled();
  });

  it("reports an existing address as a conflict", async () => {
    install();
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { code: "email_exists", message: "A user with this email address has already been registered" },
    });

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(409);
    expect(h.sendVerificationEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/auth/forgot-password", () => {
  it("emails a recovery link that lands on the reset page", async () => {
    install();
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { user: { id: "auth-1" }, properties: { hashed_token: "tok-recovery" } },
      error: null,
    });

    const res = await forgotPassword(post("/api/v1/auth/forgot-password", { email: " A@Byu.edu" }));

    expect(res.status).toBe(200);
    expect(h.service.auth.admin.generateLink).toHaveBeenCalledWith({ type: "recovery", email: "a@byu.edu" });
    const url = confirmUrlOf(h.sendPasswordResetEmail);
    expect(url.searchParams.get("type")).toBe("recovery");
    expect(url.searchParams.get("next")).toBe("/reset-password");
  });

  it("answers an unknown address identically without sending anything", async () => {
    install();
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { user: null, properties: null },
      error: { code: "user_not_found", message: "User with this email not found" },
    });

    const known = await forgotPassword(post("/api/v1/auth/forgot-password", { email: "nobody@byu.edu" }));

    expect(known.status).toBe(200);
    expect(await known.json()).toEqual({ message: "If an account exists, a reset link has been sent." });
    expect(h.sendPasswordResetEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/auth/resend-verification", () => {
  it("sends a magic link to an unconfirmed account", async () => {
    const queries = install({ users: { data: { auth_id: "auth-1", display_name: "Ana" }, error: null } });
    h.service.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "a@byu.edu", email_confirmed_at: null } },
      error: null,
    });
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok-magic" } },
      error: null,
    });

    // Typed with different capitalization than the stored row.
    const res = await resendVerification(post("/api/v1/auth/resend-verification", { email: " A@BYU.edu " }));

    expect(res.status).toBe(200);
    // Case-insensitive lookup, so rows stored as typed are still found.
    expect(queries.users[0].ilike).toHaveBeenCalledWith("email", "a@byu.edu");
    expect(queries.users[0].eq).not.toHaveBeenCalled();
    expect(confirmUrlOf(h.sendVerificationEmail).searchParams.get("uid")).toBe("auth-1");
    expect(h.service.auth.admin.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "a@byu.edu" });
    expect(confirmUrlOf(h.sendVerificationEmail).searchParams.get("type")).toBe("magiclink");
  });

  it("never generates a link for a confirmed or unknown account", async () => {
    install({ users: { data: { auth_id: "auth-1", display_name: null }, error: null } });
    h.service.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "a@byu.edu", email_confirmed_at: "2026-09-15T00:00:00Z" } },
      error: null,
    });
    await resendVerification(post("/api/v1/auth/resend-verification", { email: "a@byu.edu" }));

    install({ users: { data: null, error: null } });
    await resendVerification(post("/api/v1/auth/resend-verification", { email: "nobody@byu.edu" }));

    expect(h.service.auth.admin.generateLink).not.toHaveBeenCalled();
    expect(h.sendVerificationEmail).not.toHaveBeenCalled();
  });
});
