import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble } from "@/__tests__/support/supabase-double";

const h = vi.hoisted(() => ({ user: null as null | { id: string; auth_id: string; role: string } }));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return { createSupabaseServiceClient: async () => m.current().client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { GET, POST } from "@/app/api/v1/account/ai-photo-check/route";

const ENV = { ...process.env };
const req = (body?: unknown) =>
  new NextRequest("http://localhost:3000/api/v1/account/ai-photo-check", {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  h.user = { id: "u1", auth_id: "a1", role: "adult" };
});
afterEach(() => {
  process.env = { ...ENV };
});

function switchOn() {
  process.env.LANDMARK_PHOTO_CHECK = "on";
  process.env.ANTHROPIC_API_KEY = "k";
}

describe("/api/v1/account/ai-photo-check", () => {
  it("never asks, and never reads the table, while the feature is off", async () => {
    delete process.env.LANDMARK_PHOTO_CHECK;
    installDouble({}); // no ai_photo_check_choices table: a read would fail
    expect(await (await GET(req())).json()).toMatchObject({ ask: false, allowed: null });
    expect((await POST(req({ allowed: true }))).status).toBe(400);
  });

  it("asks an eligible adult who hasn't answered, then stores the answer with the notice version", async () => {
    switchOn();
    const db = installDouble({ ai_photo_check_choices: [] });
    expect((await (await GET(req())).json()).ask).toBe(true);
    const res = await POST(req({ allowed: false }));
    expect(res.status).toBe(200);
    expect(db.table("ai_photo_check_choices")[0]).toMatchObject({ auth_id: "a1", allowed: false, notice_version: "2026-11-13" });
    expect(await (await GET(req())).json()).toMatchObject({ ask: false, allowed: false });
  });

  it("never asks a child or a teen", async () => {
    switchOn();
    installDouble({ ai_photo_check_choices: [] });
    for (const role of ["child", "teen"]) {
      h.user = { id: "u1", auth_id: "a1", role };
      expect((await (await GET(req())).json()).ask).toBe(false);
      expect((await POST(req({ allowed: true }))).status).toBe(400);
    }
  });

  it("rejects an answer that isn't true or false", async () => {
    switchOn();
    installDouble({ ai_photo_check_choices: [] });
    expect((await POST(req({ allowed: "yes" }))).status).toBe(400);
  });
});
