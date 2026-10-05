import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { safeSearchTerm, userSearchFilter } from "@/app/api/v1/admin/users/search";

type Result = { data: unknown; error: unknown; count?: number | null };

const h = vi.hoisted(() => ({
  service: null as unknown as { from: ReturnType<typeof vi.fn> },
  user: null as null | { id: string; role: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => h.service,
}));
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));

import { GET as listUsers } from "@/app/api/v1/admin/users/route";

/** A chainable stand-in for one PostgREST query that records its calls. */
function install(result: Result) {
  const q: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {};
  for (const m of ["select", "is", "eq", "or", "order", "range"]) q[m] = vi.fn(() => q);
  (q as { then: unknown }).then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  h.service = { from: vi.fn(() => q) };
  return q;
}

const get = (qs: string) => listUsers(new NextRequest(`http://localhost/api/v1/admin/users${qs}`));

beforeEach(() => {
  h.user = { id: "admin1", role: "admin" };
});

describe("safeSearchTerm", () => {
  it("keeps the characters emails are made of", () => {
    expect(safeSearchTerm("first.last+tag@byu.edu")).toBe("first.last+tag@byu.edu");
  });

  it("removes only what could break out of the quoted filter value or act as a wildcard", () => {
    expect(safeSearchTerm('a"b\\c%d*e')).toBe("abcde");
    expect(safeSearchTerm('x",role.eq.admin,email.ilike."')).toBe("x,role.eq.admin,email.ilike.");
  });

  it("caps length", () => {
    expect(safeSearchTerm("a".repeat(500))).toHaveLength(100);
  });
});

describe("GET /api/v1/admin/users", () => {
  it("searches by a full email address, quoted so dots and commas stay literal", async () => {
    const q = install({ data: [], error: null, count: 0 });
    await get("?q=jane.doe%40byu.edu");
    expect(q.or).toHaveBeenCalledWith(userSearchFilter("jane.doe@byu.edu"));
    expect(q.or.mock.calls[0][0]).toBe(
      'display_name.ilike."%jane.doe@byu.edu%",email.ilike."%jane.doe@byu.edu%"'
    );
  });

  it("pages with an exact total", async () => {
    const q = install({ data: [{ id: "u1" }], error: null, count: 137 });
    const res = await get("?page=3&limit=50");
    expect(q.select).toHaveBeenCalledWith(expect.any(String), { count: "exact" });
    expect(q.range).toHaveBeenCalledWith(100, 149);
    expect(await res.json()).toMatchObject({ total: 137, page: 3, limit: 50, viewer: { id: "admin1", role: "admin" } });
  });

  it("falls back to sane paging for junk parameters", async () => {
    const q = install({ data: [], error: null, count: 0 });
    await get("?page=-2&limit=abc");
    expect(q.range).toHaveBeenCalledWith(0, 49);
  });

  it("surfaces a database failure as an error, not an empty list", async () => {
    install({ data: null, error: { message: "boom" }, count: null });
    const res = await get("");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("boom");
  });
});
