import { describe, it, expect, vi } from "vitest";
import {
  isMissingColumnError,
  removeSelectColumns,
  splitSelectColumns,
  withoutMissingColumn,
} from "@/lib/supabase/without-missing-column";

const COLUMNS = "id, title, cover_image_url, finds(deleted_at, tasks(challenge_type)), play_sessions(count)";

describe("splitSelectColumns / removeSelectColumns", () => {
  it("splits on top-level commas only", () => {
    expect(splitSelectColumns(COLUMNS)).toEqual([
      "id",
      "title",
      "cover_image_url",
      "finds(deleted_at, tasks(challenge_type))",
      "play_sessions(count)",
    ]);
    expect(splitSelectColumns(" a ,, b ")).toEqual(["a", "b"]);
  });

  it("removes named columns and keeps embeds intact", () => {
    expect(removeSelectColumns(COLUMNS, ["cover_image_url"])).toBe(
      "id, title, finds(deleted_at, tasks(challenge_type)), play_sessions(count)"
    );
    // Columns inside an embed are not top-level, so they stay.
    expect(removeSelectColumns(COLUMNS, ["deleted_at"])).toBe(removeSelectColumns(COLUMNS, []));
  });
});

describe("isMissingColumnError", () => {
  it("matches only Postgres 42703", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "42P01" })).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

describe("withoutMissingColumn", () => {
  it("returns the first result when it succeeds", async () => {
    const run = vi.fn(async () => ({ data: [1], error: null }));
    const result = await withoutMissingColumn(run, COLUMNS, ["cover_image_url"]);
    expect(result.data).toEqual([1]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries once without the optional columns on 42703", async () => {
    const run = vi
      .fn<(cols: string) => Promise<{ data: number[] | null; error: { code: string } | null }>>()
      .mockResolvedValueOnce({ data: null, error: { code: "42703" } })
      .mockResolvedValueOnce({ data: [2], error: null });
    const result = await withoutMissingColumn(run, COLUMNS, ["cover_image_url"]);
    expect(result).toEqual({ data: [2], error: null });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0]).not.toContain("cover_image_url");
  });

  it("does not retry on other errors", async () => {
    const run = vi.fn(async () => ({ data: null, error: { code: "57014" } }));
    const result = await withoutMissingColumn(run, COLUMNS, ["cover_image_url"]);
    expect(result.error).toEqual({ code: "57014" });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("does not retry when there is nothing to drop, and retries at most once", async () => {
    const run = vi.fn(async () => ({ data: null, error: { code: "42703" } }));
    await withoutMissingColumn(run, "id, title", ["cover_image_url"]);
    expect(run).toHaveBeenCalledTimes(1);

    run.mockClear();
    const result = await withoutMissingColumn(run, COLUMNS, ["cover_image_url"]);
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.error).toEqual({ code: "42703" });
  });
});
