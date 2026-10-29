import { describe, it, expect } from "vitest";
import { countLabel, insightsSummary, yourHuntsLinkLabel } from "@/components/home/home-copy";

describe("countLabel", () => {
  it("uses the singular for exactly one", () => {
    expect(countLabel(1, "completion")).toBe("1 completion");
  });

  it("adds an s for zero and many", () => {
    expect(countLabel(0, "hunt")).toBe("0 hunts");
    expect(countLabel(4, "hunt")).toBe("4 hunts");
  });

  it("takes an irregular plural", () => {
    expect(countLabel(2, "category", "categories")).toBe("2 categories");
    expect(countLabel(1, "category", "categories")).toBe("1 category");
  });
});

describe("insightsSummary", () => {
  it("is hidden when no hunt has comparable data, whatever the completion count", () => {
    expect(insightsSummary(0, 1)).toBeNull();
    expect(insightsSummary(0, 0)).toBeNull();
  });

  it("pluralizes both counts", () => {
    expect(insightsSummary(1, 1)).toBe("1 hunt · 1 completion");
    expect(insightsSummary(3, 12)).toBe("3 hunts · 12 completions");
  });

  it("never shows fewer completions than hunts", () => {
    // Each listed hunt has at least one completion, so a lower total is stale.
    expect(insightsSummary(3, 1)).toBe("3 hunts · 3 completions");
  });
});

describe("yourHuntsLinkLabel", () => {
  it("says See all with the total when there are hunts", () => {
    expect(yourHuntsLinkLabel(4)).toBe("See all 4");
  });

  it("falls back to My Hunts with none", () => {
    expect(yourHuntsLinkLabel(0)).toBe("My Hunts");
  });
});
