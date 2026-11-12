import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheCalls: Array<{ keyParts: string[]; options: { revalidate?: number; tags?: string[] } }> = [];
vi.mock("next/cache", () => ({
  // Pass-through cache that records how it was configured.
  unstable_cache: (fn: (...a: unknown[]) => unknown, keyParts: string[], options: { revalidate?: number; tags?: string[] }) => {
    cacheCalls.push({ keyParts, options });
    return fn;
  },
}));

type Result = { data: unknown[] | null; error: { code?: string; message: string } | null };
let results: Result[] = [];
const calls: Array<{ method: string; args: unknown[] }> = [];

function builder() {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "is", "eq", "in", "order", "limit", "textSearch", "or"]) {
    b[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return b;
    };
  }
  b.then = (resolve: (r: Result) => unknown) => resolve(results.shift() ?? { data: [], error: null });
  return b;
}

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({ from: () => builder() }),
}));

const { loadExploreCatalogue, EXPLORE_CACHE_SECONDS } = await import("@/lib/hunts/explore-catalogue");

beforeEach(() => {
  results = [];
  calls.length = 0;
});

describe("loadExploreCatalogue", () => {
  it("is cached for a short window shared by all viewers", () => {
    expect(cacheCalls).toHaveLength(1);
    expect(cacheCalls[0].options.revalidate).toBe(EXPLORE_CACHE_SECONDS);
    expect(EXPLORE_CACHE_SECONDS).toBeLessThanOrEqual(120);
  });

  it("returns the public catalogue rows", async () => {
    results = [{ data: [{ id: "h1" }], error: null }];
    const out = await loadExploreCatalogue("", null);
    expect(out).toEqual({ rows: [{ id: "h1" }], error: null });
    expect(calls.find((c) => c.method === "eq")?.args).toEqual(["is_public", true]);
    expect(calls.some((c) => c.method === "textSearch")).toBe(false);
  });

  it("applies search and audience filters when given", async () => {
    results = [{ data: [], error: null }];
    await loadExploreCatalogue("library", "target_audience.eq.adult");
    expect(calls.find((c) => c.method === "textSearch")?.args[1]).toBe("library");
    expect(calls.find((c) => c.method === "or")?.args[0]).toBe("target_audience.eq.adult");
  });

  it("returns the error instead of throwing, so a failure is never cached", async () => {
    results = [{ data: null, error: { code: "57014", message: "timeout" } }];
    const out = await loadExploreCatalogue("", null);
    expect(out.rows).toEqual([]);
    expect(out.error).toEqual({ code: "57014", message: "timeout" });
  });

  it("retries without the optional cover column on an older schema", async () => {
    results = [
      { data: null, error: { code: "42703", message: "column cover_image_url does not exist" } },
      { data: [{ id: "h2" }], error: null },
    ];
    const out = await loadExploreCatalogue("", null);
    expect(out.rows).toEqual([{ id: "h2" }]);
  });
});
