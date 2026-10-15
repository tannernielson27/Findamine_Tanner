import { describe, it, expect } from "vitest";
import {
  GRADE_BANDS,
  DEFAULT_GRADE_BAND,
  gradeBandFor,
  formatGradeRange,
  describePlayers,
  gradeRangeForAudience,
} from "@/lib/utils/grade-bands";
import { VALID_GRADE_BANDS } from "@/lib/utils/ai-validation";

describe("grade bands", () => {
  it("offers a college/adult band alongside K-12", () => {
    expect(GRADE_BANDS.map((b) => b.value)).toEqual(["K-2", "3-5", "6-8", "9-12", "college"]);
    expect(VALID_GRADE_BANDS).toEqual(GRADE_BANDS.map((b) => b.value));
  });

  it("defaults the builders to college for the undergraduate cohort", () => {
    expect(DEFAULT_GRADE_BAND).toBe("college");
  });

  it("maps college to an adult audience and grades 13-16", () => {
    const college = gradeBandFor("college");
    expect(college.audience).toBe("adults");
    expect(college.range).toEqual({ min: 13, max: 16 });
  });

  it("searches the library from high-school level up for college, since the library tops out at grade 12", () => {
    expect(gradeBandFor("college").libraryRange).toEqual({ min: 9, max: 16 });
    expect(gradeBandFor("6-8").libraryRange).toEqual({ min: 6, max: 8 });
  });

  it("keeps K-12 audiences as before", () => {
    expect(gradeBandFor("K-2").audience).toBe("kids");
    expect(gradeBandFor("3-5").audience).toBe("kids");
    expect(gradeBandFor("6-8").audience).toBe("teens");
    expect(gradeBandFor("9-12").audience).toBe("teens");
  });

  it("falls back to the default band for unknown values", () => {
    expect(gradeBandFor("grad-school").value).toBe(DEFAULT_GRADE_BAND);
  });

  it("formats grade ranges with college levels spelled out", () => {
    expect(formatGradeRange(3, 5)).toBe("Gr 3-5");
    expect(formatGradeRange(0, 2)).toBe("Gr K-2");
    expect(formatGradeRange(9, 16)).toBe("Gr 9-College");
    expect(formatGradeRange(13, 16)).toBe("College");
    expect(formatGradeRange(null, null)).toBe("");
  });
});

describe("describePlayers", () => {
  it("describes K-12 ranges as grades", () => {
    expect(describePlayers({ min: 3, max: 5 }, "x")).toBe("students in grades 3-5");
  });
  it("describes college ranges as adults", () => {
    expect(describePlayers({ min: 13, max: 16 }, "x")).toContain("college undergraduates");
    expect(describePlayers({ min: 9, max: 16 }, "x")).toContain("college-age adults");
  });
  it("uses the fallback when no range is known", () => {
    expect(describePlayers(undefined, "students in grades 3-8")).toBe("students in grades 3-8");
  });
});

describe("gradeRangeForAudience", () => {
  it("maps adult hunts to college level and leaves mixed audiences open", () => {
    expect(gradeRangeForAudience("adults")).toEqual({ min: 13, max: 16 });
    expect(gradeRangeForAudience("teens")).toEqual({ min: 7, max: 12 });
    expect(gradeRangeForAudience("kids")).toEqual({ min: 1, max: 6 });
    expect(gradeRangeForAudience("all")).toBeUndefined();
    expect(gradeRangeForAudience(null)).toBeUndefined();
  });
});
