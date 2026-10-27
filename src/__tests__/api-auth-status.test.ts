import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * getAuthUser is where a sanctioned account loses API access: routes use the
 * service client, which bypasses RLS, so the status check has to live here.
 */

const h = vi.hoisted(() => ({ profile: null as null | Record<string, unknown> }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: "auth-1", role: "authenticated" } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: h.profile ? { ...h.profile, user_profiles: { effective_band: "adult" } } : null,
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { getAuthUser } from "@/lib/utils/api-auth";

function bearerRequest() {
  return new NextRequest("https://findamine.app/api/v1/auth/me", {
    headers: { authorization: "Bearer token" },
  });
}

const base = { id: "u1", auth_id: "auth-1", role: "adult", display_name: "Sam" };

describe("getAuthUser account status", () => {
  beforeEach(() => {
    h.profile = null;
  });

  it("returns active users without the status field", async () => {
    h.profile = { ...base, status: "active" };
    expect(await getAuthUser(bearerRequest())).toEqual({ ...base, effective_band: "adult" });
  });

  it.each(["suspended", "banned", "inactive"])("rejects %s accounts", async (status) => {
    h.profile = { ...base, status };
    expect(await getAuthUser(bearerRequest())).toBeNull();
  });

  it("still resolves pending_consent accounts (the proxy gates them)", async () => {
    h.profile = { ...base, role: "child", status: "pending_consent" };
    expect(await getAuthUser(bearerRequest())).toEqual({ ...base, role: "child", effective_band: "adult" });
  });

  it("returns null when there is no profile", async () => {
    expect(await getAuthUser(bearerRequest())).toBeNull();
  });
});
