import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  blocked: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({
    from: (table: string) => ({
      insert: async (row: Record<string, unknown>) => {
        h.inserts.push({ table, row });
        return { error: null };
      },
      select: () => ({
        eq: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: async () => ({
                data: h.blocked ? { id: "b1", expires_at: null } : null,
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { botGuard } from "@/lib/utils/bot-guard";

function request(userAgent: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/auth/login", {
    method: "POST",
    headers: { "user-agent": userAgent, "x-forwarded-for": "203.0.113.7" },
  });
}

const BROWSER =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

beforeEach(() => {
  h.inserts = [];
  h.blocked = false;
});

describe("botGuard", () => {
  it("rejects a definite bot without blocking its IP", async () => {
    const res = await botGuard(request("curl/8.4.0"));

    expect(res?.status).toBe(403);
    expect(h.inserts.filter((i) => i.table === "blocked_ips")).toHaveLength(0);
    expect(h.inserts.some((i) => i.table === "behavioral_events" && i.row.event_type === "bot_blocked")).toBe(true);
  });

  it("lets a normal browser through from the same address afterwards", async () => {
    await botGuard(request("curl/8.4.0"));
    expect(await botGuard(request(BROWSER))).toBeNull();
  });

  it("still honors a block an admin put in place", async () => {
    h.blocked = true;
    const res = await botGuard(request(BROWSER));
    expect(res?.status).toBe(403);
  });
});
