import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Result = { data: unknown; error: unknown };

/** A chainable stand-in for one PostgREST query that resolves to `result`. */
function query(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "delete", "upsert", "eq", "is"]) q[m] = vi.fn(() => q);
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
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => h.service,
}));
vi.mock("@/lib/utils/rate-limit", () => ({ authLimiter: { check: async () => {} } }));
vi.mock("@/lib/utils/bot-guard", () => ({ botGuard: async () => null }));
vi.mock("@/lib/utils/track-event", () => ({ trackEvent: () => {} }));
vi.mock("@/lib/services/enrollment", () => ({ enrollParticipant: h.enrollParticipant }));
vi.mock("@/lib/services/referral", () => ({ redeemReferral: async () => {} }));
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

function install(tables: Record<string, Result> = {}) {
  const queries: Record<string, ReturnType<typeof query>[]> = {};
  h.service = {
    from: vi.fn((table: string) => {
      const q = query(tables[table] ?? { data: null, error: null });
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
});

const ADULT = { email: "a@byu.edu", password: "long-enough-1", display_name: "Ana", role: "adult", date_of_birth: "2000-01-01" };

describe("POST /api/v1/auth/register", () => {
  it("creates the account through a signup link and emails the confirmation", async () => {
    install({ users: { data: { id: "u1", email: ADULT.email, display_name: "Ana", role: "adult" }, error: null } });
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { user: { id: "auth-1" }, properties: { hashed_token: "tok-signup" } },
      error: null,
    });

    const res = await register(post("/api/v1/auth/register", ADULT));

    expect(res.status).toBe(201);
    expect(h.service.auth.admin.generateLink).toHaveBeenCalledWith({ type: "signup", email: ADULT.email, password: ADULT.password });
    const url = confirmUrlOf(h.sendVerificationEmail);
    expect(url.origin).toBe("https://findamine.test");
    expect(url.searchParams.get("token_hash")).toBe("tok-signup");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(h.enrollParticipant).toHaveBeenCalledWith("u1");
  });

  it("rolls the account back when the confirmation email cannot be sent", async () => {
    const queries = install({ users: { data: { id: "u1", email: ADULT.email }, error: null } });
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { user: { id: "auth-1" }, properties: { hashed_token: "tok" } },
      error: null,
    });
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

    const res = await forgotPassword(post("/api/v1/auth/forgot-password", { email: "a@byu.edu" }));

    expect(res.status).toBe(200);
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
    install({ users: { data: { auth_id: "auth-1", display_name: "Ana" }, error: null } });
    h.service.auth.admin.getUserById.mockResolvedValue({
      data: { user: { email: "a@byu.edu", email_confirmed_at: null } },
      error: null,
    });
    h.service.auth.admin.generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "tok-magic" } },
      error: null,
    });

    const res = await resendVerification(post("/api/v1/auth/resend-verification", { email: "a@byu.edu" }));

    expect(res.status).toBe(200);
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
