import { describe, expect, it } from "vitest";
import { chunk, ID_BATCH_SIZE } from "@/lib/utils/chunk";

describe("chunk", () => {
  it("returns no batches for an empty list", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("splits into batches of the given size, last one short", () => {
    expect(chunk([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it("keeps a list no longer than the size in one batch", () => {
    expect(chunk(["a", "b"], 5)).toEqual([["a", "b"]]);
  });

  it("does not mutate the input", () => {
    const input = Object.freeze([1, 2, 3, 4]);
    expect(chunk(input, 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("rejects a size below 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });

  it("keeps an id batch's filter well under URL limits", () => {
    // 36-char uuid + comma per id
    expect(ID_BATCH_SIZE * 37).toBeLessThan(8000);
  });
});
