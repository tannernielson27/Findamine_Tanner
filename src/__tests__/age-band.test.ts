import { describe, it, expect } from "vitest";
import { bandForUser } from "@/lib/utils/age-band";

describe("bandForUser", () => {
  it("uses the stored band when there is one", () => {
    expect(bandForUser("primary", "adult")).toBe("primary");
    expect(bandForUser("adult", "child")).toBe("adult");
  });

  it("falls back by role when no band is stored", () => {
    expect(bandForUser(null, "child")).toBe("intermediate");
    expect(bandForUser(undefined, "teen")).toBe("teen");
    expect(bandForUser(null, "adult")).toBe("adult");
    expect(bandForUser(null, "parent")).toBe("adult");
    expect(bandForUser(null, "teacher")).toBe("adult");
    expect(bandForUser(null, null)).toBe("adult");
  });

  it("ignores an unknown stored band", () => {
    expect(bandForUser("toddler", "teen")).toBe("teen");
  });
});
