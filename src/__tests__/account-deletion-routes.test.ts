import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * DELETE /api/v1/account: in-app account deletion (App Store 5.1.1(v)).
 * The database work is one RPC (migration 071); these tests pin the route's
 * auth, confirmation, ordering and failure handling around it.
 */

type Err = { code?: string; message: string; status?: number } | null;

const h = vi.hoisted(() => ({
  authId: null as string | null,
  profile: null as null | { id: string; deleted_at: string | null; role?: string },
  otherAdmins: [] as { id: string }[],
  profileError: null as Err,
  rpcResult: { data: null as unknown, error: null as Err },
  rpcCalls: [] as unknown[],
  deleteUserErrors: {} as Record<string, Err[]>,
  deletedAuthIds: [] as string[],
  removed: [] as { bucket: string; paths: string[] }[],
  listed: {} as Record<string, { name: string }[]>,
  removeError: null as Err,
  calls: [] as string[],
  limited: false,
}));

function serviceClient() {
  return {
    auth: {
      getUser: async (token: string) => ({
        data: { user: token === "good-token" && h.authId ? { id: h.authId } : null },
      }),
      admin: {
        deleteUser: async (id: string) => {
          h.calls.push(`auth:${id}`);
          const queue = h.deleteUserErrors[id];
          const error = queue && queue.length > 0 ? queue.shift()! : null;
          if (!error) h.deletedAuthIds.push(id);
          return { data: {}, error };
        },
      },
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "neq"]) q[m] = () => q;
      q.maybeSingle = async () =>
        table === "users" ? { data: h.profile, error: h.profileError } : { data: null, error: null };
      // The "other active admins" lookup ends in .limit().
      q.limit = async () => ({ data: h.otherAdmins, error: null });
      return q;
    },
    rpc: async (fn: string, args: unknown) => {
      h.calls.push(`rpc:${fn}`);
      h.rpcCalls.push(args);
      return h.rpcResult;
    },
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          h.calls.push(`storage:${bucket}`);
          h.removed.push({ bucket, paths });
          for (const p of paths) {
            const folder = p.split("/")[0];
            const key = `${bucket}:${folder}`;
            h.listed[key] = (h.listed[key] || []).filter((f) => `${folder}/${f.name}` !== p);
          }
          return { data: null, error: h.removeError };
        },
        list: async (folder: string) => ({ data: h.listed[`${bucket}:${folder}`] || [], error: null }),
      }),
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => serviceClient(),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.authId ? { id: h.authId } : null } }) },
  }),
}));
vi.mock("@/lib/utils/rate-limit", async () => {
  const { ApiError } = await import("@/lib/utils/api-auth");
  return {
    authLimiter: {
      check: async () => {
        if (h.limited) throw new ApiError(429, "Too many attempts.");
      },
    },
  };
});
vi.mock("@/lib/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DELETE } from "@/app/api/v1/account/route";

function del(body: unknown, opts: { bearer?: string; cookies?: string } = {}): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.bearer) headers.Authorization = `Bearer ${opts.bearer}`;
  if (opts.cookies) headers.Cookie = opts.cookies;
  return new NextRequest("http://localhost:3000/api/v1/account", {
    method: "DELETE",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const CONFIRM = { confirm: "DELETE" };

beforeEach(() => {
  h.authId = "auth-1";
  h.profile = { id: "u1", deleted_at: null };
  h.profileError = null;
  h.rpcResult = {
    data: { accounts: [{ user_id: "u1", auth_id: "auth-1" }], storage: [] },
    error: null,
  };
  h.rpcCalls = [];
  h.deleteUserErrors = {};
  h.deletedAuthIds = [];
  h.removed = [];
  h.listed = {};
  h.removeError = null;
  h.calls = [];
  h.limited = false;
  h.otherAdmins = [];
});

describe("DELETE /api/v1/account — last admin and cross-site requests", () => {
  it("refuses to delete the last remaining admin (L7)", async () => {
    h.profile = { id: "u1", deleted_at: null, role: "admin" };
    h.otherAdmins = [];
    const res = await DELETE(del(CONFIRM, { cookies: "sb-x-auth-token=abc" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/only admin/);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("lets an admin delete their account when another admin remains", async () => {
    h.profile = { id: "u1", deleted_at: null, role: "admin" };
    h.otherAdmins = [{ id: "u2" }];
    const res = await DELETE(del(CONFIRM, { cookies: "sb-x-auth-token=abc" }));
    expect(res.status).toBe(200);
    expect(h.rpcCalls).toHaveLength(1);
  });

  it("refuses a cross-site cookie request (L3)", async () => {
    const req = new NextRequest("http://localhost:3000/api/v1/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example", Cookie: "sb-x-auth-token=abc" },
      body: JSON.stringify(CONFIRM),
    });
    expect((await DELETE(req)).status).toBe(403);
    expect(h.rpcCalls).toHaveLength(0);
  });
});

describe("DELETE /api/v1/account — auth and confirmation", () => {
  it("requires a signed-in caller", async () => {
    h.authId = null;
    const res = await DELETE(del(CONFIRM));
    expect(res.status).toBe(401);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("rejects an invalid bearer token", async () => {
    const res = await DELETE(del(CONFIRM, { bearer: "forged" }));
    expect(res.status).toBe(401);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("requires the typed confirmation", async () => {
    for (const body of [undefined, {}, { confirm: "delete" }, { confirm: "yes" }]) {
      const res = await DELETE(del(body));
      expect(res.status).toBe(400);
    }
    expect(h.rpcCalls).toHaveLength(0);
    expect(h.deletedAuthIds).toHaveLength(0);
  });

  it("is rate limited", async () => {
    h.limited = true;
    expect((await DELETE(del(CONFIRM))).status).toBe(429);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("refuses an account an admin already closed", async () => {
    h.profile = { id: "u1", deleted_at: "2026-01-01T00:00:00Z" };
    expect((await DELETE(del(CONFIRM))).status).toBe(403);
    expect(h.rpcCalls).toHaveLength(0);
  });
});

describe("DELETE /api/v1/account — success", () => {
  it("deletes the data, then the auth user, and clears the session cookies", async () => {
    const res = await DELETE(
      del(CONFIRM, { cookies: "sb-abc-auth-token.0=x; sb-abc-auth-token.1=y; theme=dark" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, deleted_accounts: 1 });
    expect(h.rpcCalls).toEqual([{ p_user_id: "u1" }]);
    expect(h.deletedAuthIds).toEqual(["auth-1"]);
    // Database first: the auth delete must never run before the data is gone.
    expect(h.calls.indexOf("rpc:delete_user_account")).toBeLessThan(h.calls.indexOf("auth:auth-1"));

    const cookies = res.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies.every((c) => c.includes("Max-Age=0"))).toBe(true);
    expect(cookies.some((c) => c.startsWith("theme="))).toBe(false);
  });

  it("works for the mobile app's bearer token", async () => {
    const res = await DELETE(del(CONFIRM, { bearer: "good-token" }));
    expect(res.status).toBe(200);
    expect(h.deletedAuthIds).toEqual(["auth-1"]);
  });

  it("removes the photos and uploads the database step reports, plus the user's folders", async () => {
    h.rpcResult.data = {
      accounts: [{ user_id: "u1", auth_id: "auth-1" }],
      storage: [
        { bucket: "geo-selfies", path: "u1/f1_1.jpg" },
        { bucket: "avatars", path: "u1/a.png" },
      ],
    };
    h.listed["captures:u1"] = [{ name: "stray.webm" }];
    const res = await DELETE(del(CONFIRM));
    expect(res.status).toBe(200);
    expect(h.removed).toEqual(
      expect.arrayContaining([
        { bucket: "geo-selfies", paths: ["u1/f1_1.jpg"] },
        { bucket: "avatars", paths: ["u1/a.png"] },
        { bucket: "captures", paths: ["u1/stray.webm"] },
      ])
    );
  });

  it("deletes a parent's child accounts' sign-ins too, the parent's last", async () => {
    h.rpcResult.data = {
      accounts: [
        { user_id: "c1", auth_id: "auth-c1" },
        { user_id: "c2", auth_id: null },
        { user_id: "u1", auth_id: "auth-1" },
      ],
      storage: [],
    };
    const res = await DELETE(del(CONFIRM));
    expect(res.status).toBe(200);
    expect((await res.json()).deleted_accounts).toBe(3);
    expect(h.deletedAuthIds).toEqual(["auth-c1", "auth-1"]);
  });

  it("retries a transient auth delete failure", async () => {
    h.deleteUserErrors["auth-1"] = [{ message: "timeout", status: 500 }];
    expect((await DELETE(del(CONFIRM))).status).toBe(200);
    expect(h.deletedAuthIds).toEqual(["auth-1"]);
  });

  it("still succeeds when photo cleanup fails (data and sign-in are gone)", async () => {
    h.rpcResult.data = {
      accounts: [{ user_id: "u1", auth_id: "auth-1" }],
      storage: [{ bucket: "geo-selfies", path: "u1/f.jpg" }],
    };
    h.removeError = { message: "storage down" };
    expect((await DELETE(del(CONFIRM))).status).toBe(200);
    expect(h.deletedAuthIds).toEqual(["auth-1"]);
  });
});

describe("DELETE /api/v1/account — failures", () => {
  it("returns 500 and keeps the sign-in when the database step fails", async () => {
    h.rpcResult = { data: null, error: { code: "23503", message: "fk violation on secret_table" } };
    const res = await DELETE(del(CONFIRM));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/Nothing was changed/);
    expect(body.error).not.toMatch(/secret_table/);
    expect(h.deletedAuthIds).toHaveLength(0);
    expect(res.headers.getSetCookie()).toHaveLength(0);
  });

  it("returns 500 when the profile lookup fails", async () => {
    h.profileError = { message: "db down" };
    expect((await DELETE(del(CONFIRM))).status).toBe(500);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("returns 404 when the account vanished between lookup and delete", async () => {
    h.rpcResult = { data: null, error: { code: "P0002", message: "account_not_found" } };
    expect((await DELETE(del(CONFIRM))).status).toBe(404);
    expect(h.deletedAuthIds).toHaveLength(0);
  });

  it("returns 500 when the caller's sign-in cannot be deleted", async () => {
    h.deleteUserErrors["auth-1"] = [
      { message: "down", status: 500 },
      { message: "down", status: 500 },
    ];
    const res = await DELETE(del(CONFIRM));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/try again/);
  });

  it("finishes a half-done deletion on retry (no profile left, only the sign-in)", async () => {
    h.profile = null;
    const res = await DELETE(del(CONFIRM));
    expect(res.status).toBe(200);
    expect(h.rpcCalls).toHaveLength(0);
    expect(h.deletedAuthIds).toEqual(["auth-1"]);
  });

  it("treats an already-deleted auth user as done", async () => {
    h.profile = null;
    h.deleteUserErrors["auth-1"] = [{ message: "User not found", status: 404 }];
    expect((await DELETE(del(CONFIRM))).status).toBe(200);
  });
});
