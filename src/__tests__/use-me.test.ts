import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchMe, invalidateMe } from "@/lib/hooks/use-me";

function okResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
}

describe("fetchMe", () => {
  beforeEach(() => {
    invalidateMe();
    vi.stubGlobal("fetch", vi.fn(() => okResponse({ user: { id: "u1" } })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("dedupes concurrent calls into one request", async () => {
    const [a, b] = await Promise.all([fetchMe(), fetchMe()]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("serves the cache, then refetches after invalidate", async () => {
    await fetchMe();
    await fetchMe();
    expect(fetch).toHaveBeenCalledTimes(1);
    invalidateMe();
    await fetchMe();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns null and does not cache failures", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false } as Response)));
    expect(await fetchMe()).toBeNull();
    expect(await fetchMe()).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
