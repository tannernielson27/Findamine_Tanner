import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";
import { normalizePushToken, parseDeviceRegistration, parseDeviceRemoval } from "@/lib/native/push-token";

const h = vi.hoisted(() => ({
  user: null as null | { id: string; role: string },
  missingTable: false,
}));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  const missing = {
    from: () => {
      const result = { data: null, error: { code: "42P01", message: 'relation "push_devices" does not exist' } };
      const chain: Record<string, unknown> = {
        upsert: () => chain,
        delete: () => chain,
        eq: () => chain,
        then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve),
      };
      return chain;
    },
  };
  const client = async () => (h.missingTable ? missing : m.current().client);
  return { createSupabaseServiceClient: client, createSupabaseServerClient: client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  generalLimiter: { check: async () => {} },
}));

import { POST, DELETE } from "@/app/api/v1/notifications/devices/route";

const ORIGIN = "https://findamine.test";
const ALICE = "11111111-aaaa-4aaa-8aaa-111111111111";
const BOB = "22222222-bbbb-4bbb-8bbb-222222222222";
const TOKEN = "A1B2C3D4".repeat(8); // 64 hex chars, mixed case as some SDKs report
const TOKEN_LC = TOKEN.toLowerCase();

function req(method: "POST" | "DELETE", body: unknown, origin: string | null = ORIGIN): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (origin) headers.origin = origin;
  return new NextRequest(`${ORIGIN}/api/v1/notifications/devices`, {
    method,
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let db: SupabaseDouble;

beforeEach(() => {
  h.user = { id: ALICE, role: "adult" };
  h.missingTable = false;
  db = installDouble({ push_devices: [] }, { unique: { push_devices: [["token"]] } });
});

describe("push token validation", () => {
  it("accepts a 64-char APNs hex token and lowercases it", () => {
    expect(normalizePushToken("ios", ` ${TOKEN} `)).toBe(TOKEN_LC);
  });

  it("rejects non-hex, short, oversized and non-string iOS tokens", () => {
    expect(normalizePushToken("ios", "z".repeat(64))).toBeNull();
    expect(normalizePushToken("ios", "ab".repeat(20))).toBeNull();
    expect(normalizePushToken("ios", "ab".repeat(101))).toBeNull();
    expect(normalizePushToken("ios", 12345)).toBeNull();
    expect(normalizePushToken("ios", "<script>alert(1)</script>")).toBeNull();
  });

  it("accepts an FCM-style token for android", () => {
    const fcm = "dQw4w9WgXcQ:APA91b" + "x".repeat(140);
    expect(normalizePushToken("android", fcm)).toBe(fcm);
    expect(normalizePushToken("android", "has spaces in it but is long enough to pass length")).toBeNull();
  });

  it("parses a registration and validates platform and app_version", () => {
    expect(parseDeviceRegistration({ token: TOKEN, platform: "ios", app_version: "1.0 (3)" })).toEqual({
      ok: true,
      value: { token: TOKEN_LC, platform: "ios", app_version: "1.0 (3)" },
    });
    expect(parseDeviceRegistration({ token: TOKEN, platform: "ios" })).toMatchObject({ ok: true, value: { app_version: null } });
    expect(parseDeviceRegistration({ token: TOKEN, platform: "windows" }).ok).toBe(false);
    expect(parseDeviceRegistration({ token: TOKEN, platform: "ios", app_version: "x".repeat(41) }).ok).toBe(false);
    expect(parseDeviceRegistration({ token: TOKEN, platform: "ios", app_version: 3 }).ok).toBe(false);
    expect(parseDeviceRegistration(null).ok).toBe(false);
    expect(parseDeviceRegistration([TOKEN]).ok).toBe(false);
  });

  it("parses a removal, defaulting to ios", () => {
    expect(parseDeviceRemoval({ token: TOKEN })).toEqual({ ok: true, value: { token: TOKEN_LC } });
    expect(parseDeviceRemoval({ token: "nope" }).ok).toBe(false);
    expect(parseDeviceRemoval({ token: TOKEN, platform: "web" }).ok).toBe(false);
    expect(parseDeviceRemoval("token").ok).toBe(false);
  });
});

describe("POST /api/v1/notifications/devices", () => {
  it("requires a signed-in user", async () => {
    h.user = null;
    const res = await POST(req("POST", { token: TOKEN, platform: "ios" }));
    expect(res.status).toBe(401);
    expect(db.table("push_devices")).toHaveLength(0);
  });

  it("refuses a cross-site origin", async () => {
    const res = await POST(req("POST", { token: TOKEN, platform: "ios" }, "https://evil.example"));
    expect(res.status).toBe(403);
    expect(db.table("push_devices")).toHaveLength(0);
  });

  it("accepts the iOS wrapper's local origin", async () => {
    const res = await POST(req("POST", { token: TOKEN, platform: "ios" }, "capacitor://localhost"));
    expect(res.status).toBe(201);
  });

  it("refuses child accounts", async () => {
    h.user = { id: ALICE, role: "child" };
    const res = await POST(req("POST", { token: TOKEN, platform: "ios" }));
    expect(res.status).toBe(403);
    expect(db.table("push_devices")).toHaveLength(0);
  });

  it("rejects an invalid token or malformed JSON with 400", async () => {
    expect((await POST(req("POST", { token: "abc", platform: "ios" }))).status).toBe(400);
    expect((await POST(req("POST", "{not json"))).status).toBe(400);
  });

  it("stores the token for the caller, lowercased", async () => {
    const res = await POST(req("POST", { token: TOKEN, platform: "ios", app_version: "1.0 (1)" }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ registered: true });
    const rows = db.table("push_devices");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user_id: ALICE, token: TOKEN_LC, platform: "ios", app_version: "1.0 (1)" });
  });

  it("re-registering is idempotent, and a phone that signs into another account moves to it", async () => {
    await POST(req("POST", { token: TOKEN, platform: "ios" }));
    await POST(req("POST", { token: TOKEN, platform: "ios" }));
    expect(db.table("push_devices")).toHaveLength(1);

    h.user = { id: BOB, role: "adult" };
    await POST(req("POST", { token: TOKEN, platform: "ios" }));
    const rows = db.table("push_devices");
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(BOB);
  });

  it("answers 503 before migration 078 is applied", async () => {
    h.missingTable = true;
    const res = await POST(req("POST", { token: TOKEN, platform: "ios" }));
    expect(res.status).toBe(503);
  });
});

describe("DELETE /api/v1/notifications/devices", () => {
  beforeEach(() => {
    db = installDouble(
      {
        push_devices: [
          { id: "d1", user_id: ALICE, token: TOKEN_LC, platform: "ios" },
          { id: "d2", user_id: BOB, token: "ff".repeat(32), platform: "ios" },
        ],
      },
      { unique: { push_devices: [["token"]] } }
    );
  });

  it("requires a signed-in user", async () => {
    h.user = null;
    expect((await DELETE(req("DELETE", { token: TOKEN }))).status).toBe(401);
    expect(db.table("push_devices")).toHaveLength(2);
  });

  it("removes the caller's own device", async () => {
    const res = await DELETE(req("DELETE", { token: TOKEN }));
    expect(res.status).toBe(200);
    expect(db.table("push_devices").map((r) => r.id)).toEqual(["d2"]);
  });

  it("never removes someone else's device", async () => {
    const res = await DELETE(req("DELETE", { token: "ff".repeat(32) }));
    expect(res.status).toBe(200);
    expect(db.table("push_devices")).toHaveLength(2);
  });

  it("rejects an invalid token and a cross-site origin", async () => {
    expect((await DELETE(req("DELETE", { token: "x" }))).status).toBe(400);
    expect((await DELETE(req("DELETE", { token: TOKEN }, "https://evil.example"))).status).toBe(403);
    expect(db.table("push_devices")).toHaveLength(2);
  });

  it("succeeds quietly before migration 078 is applied", async () => {
    h.missingTable = true;
    expect((await DELETE(req("DELETE", { token: TOKEN }))).status).toBe(200);
  });
});
