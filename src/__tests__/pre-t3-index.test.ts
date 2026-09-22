import { describe, it, expect } from "vitest";
import { preT3Index, type IndexPoint } from "@/lib/utils/pre-t3-index";

const series: IndexPoint[] = [
  { created_at: "2026-09-01T08:00:00Z", index: 0.5 },
  { created_at: "2026-10-10T08:00:00Z", index: 0.6 },
  { created_at: "2026-10-13T09:00:00Z", index: 0.9 }, // after T3 opened
];

describe("preT3Index", () => {
  it("uses the last snapshot before the T3 delivery", () => {
    expect(preT3Index(series, "2026-10-13T08:30:00Z", "2026-09-01T00:00:00Z")).toBe(0.6);
  });

  it("falls back to enrollment + 42 days when T3 was never delivered", () => {
    // 2026-09-01 + 42d = 2026-10-13T00:00Z, before the 0.9 snapshot.
    expect(preT3Index(series, undefined, "2026-09-01T00:00:00Z")).toBe(0.6);
  });

  it("takes the earlier cutoff when a late T3 delivery would include post-day-42 changes", () => {
    expect(preT3Index(series, "2026-10-20T00:00:00Z", "2026-09-01T00:00:00Z")).toBe(0.6);
  });

  it("includes a snapshot taken exactly at the cutoff", () => {
    expect(preT3Index(series, "2026-10-10T08:00:00Z", undefined)).toBe(0.6);
  });

  it("is null without a cutoff or without any earlier snapshot", () => {
    expect(preT3Index(series, undefined, undefined)).toBeNull();
    expect(preT3Index(series, "2026-08-01T00:00:00Z", undefined)).toBeNull();
    expect(preT3Index([], "2026-10-13T08:30:00Z", undefined)).toBeNull();
  });
});
