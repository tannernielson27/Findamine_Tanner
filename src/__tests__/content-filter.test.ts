import { describe, it, expect } from "vitest";
import { checkText, filterLevelForRole, normalizeForFilter } from "@/lib/moderation/content-filter";
import { assertCleanText } from "@/lib/moderation/guard";
import { ApiError } from "@/lib/utils/api-auth";

const blocked = (text: string, level: "standard" | "strict" = "standard") => !checkText(text, level).allowed;

describe("normalizeForFilter", () => {
  it("lowercases, strips accents and zero-width characters", () => {
    expect(normalizeForFilter("HÉLLO​there")).toBe("hellothere");
  });

  it("maps leetspeak and look-alike letters", () => {
    expect(normalizeForFilter("sh1t $lut")).toBe("shit slut");
    expect(normalizeForFilter("аss")).toBe("ass"); // Cyrillic a
  });

  it("joins spaced or dotted single letters", () => {
    expect(normalizeForFilter("f u c k").split(" ")).toContain("fuck");
    expect(normalizeForFilter("s.h.i.t").split(" ")).toContain("shit");
  });

  it("treats trailing ! as punctuation, not a letter", () => {
    expect(normalizeForFilter("wow!!")).toBe("wow");
  });
});

describe("checkText (standard)", () => {
  it.each([
    "what the fuck",
    "FUUUUCK this",
    "f*ck off",
    "sh1t",
    "f u c k you",
    "you b!tch",
    "kys",
    "go kill yourself",
    "send nudes",
    "you're a retard",
    "f​uck",
  ])("blocks %j", (text) => {
    expect(blocked(text)).toBe(true);
  });

  it.each([
    "Great teamwork today!",
    "hello there",
    "I'm in class right now",
    "Scunthorpe is a town",
    "grapes and spicy shiitake",
    "pass the assessment",
    "Dickens wrote books",
    "I found the clue at 5 Main St",
    "That was hard, damn" /* mild: only strict */,
    "you're so dumb lol" /* insult: only strict */,
  ])("allows %j", (text) => {
    expect(blocked(text)).toBe(false);
  });

  it("reports the category without the matched word", () => {
    expect(checkText("you're a fag")).toEqual({ allowed: false, category: "slur", level: "standard" });
  });

  it("allows empty text", () => {
    expect(checkText("")).toEqual({ allowed: true });
  });
});

describe("checkText (strict, for children)", () => {
  it("also blocks mild swearing and insults", () => {
    for (const text of ["damn it", "you're stupid", "shut up", "what the hell", "ur so dumb", "s t u p i d"]) {
      expect(blocked(text, "strict")).toBe(true);
    }
  });

  it("still allows ordinary kid chat", () => {
    for (const text of ["hello!", "I found it!!", "lets go to the shell", "that hunt was awesome"]) {
      expect(blocked(text, "strict")).toBe(false);
    }
  });
});

describe("filterLevelForRole", () => {
  it("gives children the strict level", () => {
    expect(filterLevelForRole("child")).toBe("strict");
    expect(filterLevelForRole("teen")).toBe("standard");
    expect(filterLevelForRole(undefined)).toBe("standard");
  });
});

describe("assertCleanText", () => {
  it("throws a friendly 422 naming the field, never the word", () => {
    try {
      assertCleanText("fuck", { label: "That team name" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).statusCode).toBe(422);
      expect((e as ApiError).message).toMatch(/^That team name includes language/);
      expect((e as ApiError).message).not.toMatch(/fuck/);
    }
  });

  it("uses the strict level for a child", () => {
    expect(() => assertCleanText("you're stupid", { role: "teen" })).not.toThrow();
    expect(() => assertCleanText("you're stupid", { role: "child" })).toThrow(ApiError);
  });

  it("ignores empty values", () => {
    expect(() => assertCleanText(null)).not.toThrow();
  });
});
