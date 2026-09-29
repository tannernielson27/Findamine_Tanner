import { describe, it, expect } from "vitest";
import {
  nextItemCode,
  scaleConfigForType,
  buildQuestionRows,
  optionsToText,
  textToOptions,
  SurveyValidationError,
} from "@/lib/utils/survey-authoring";

describe("nextItemCode", () => {
  it("starts at item_1", () => {
    expect(nextItemCode([])).toBe("item_1");
  });

  it("skips codes already in use after a deletion", () => {
    // item_1 was deleted; list length is 1 but item_2 is taken.
    expect(nextItemCode(["item_2"])).toBe("item_3");
  });

  it("fills past the highest numbered code, ignoring custom codes", () => {
    expect(nextItemCode(["fatigue_1", "item_1", "item_4"])).toBe("item_5");
  });
});

describe("scaleConfigForType", () => {
  it("resets the range to 1-7 when switching to likert_7, keeping labels", () => {
    const cfg = scaleConfigForType("likert_7", {
      min: 1,
      max: 5,
      min_label: "Never",
      max_label: "Always",
    });
    expect(cfg).toEqual({ min: 1, max: 7, min_label: "Never", max_label: "Always" });
  });

  it("resets the range to 1-5 when switching to likert_5", () => {
    expect(scaleConfigForType("likert_5", { min: 1, max: 7 })).toMatchObject({ min: 1, max: 5 });
  });

  it("gives a slider a 0-100 range", () => {
    expect(scaleConfigForType("slider", { min: 1, max: 5 })).toMatchObject({ min: 0, max: 100 });
  });

  it("clears the scale for non-scale types", () => {
    expect(scaleConfigForType("free_text", { min: 1, max: 5 })).toEqual({});
  });
});

describe("options text round-trip", () => {
  it("shows value|label pairs and plain strings one per line", () => {
    expect(
      optionsToText([{ value: "nobody", label: "Only me" }, "Maybe", { value: "x", label: "x" }])
    ).toBe("nobody | Only me\nMaybe\nx");
  });

  it("parses lines back, keeping labels distinct from stored values", () => {
    expect(textToOptions("nobody | Only me\n  Maybe  \n\n")).toEqual([
      { value: "nobody", label: "Only me" },
      "Maybe",
    ]);
  });

  it("round-trips seeded options unchanged", () => {
    const seeded = [
      { value: "nobody", label: "Only me" },
      { value: "team", label: "My team" },
    ];
    expect(textToOptions(optionsToText(seeded))).toEqual(seeded);
  });
});

describe("buildQuestionRows", () => {
  const base = {
    item_code: "q1",
    question_text: "How are you?",
    question_type: "likert_7",
    scale_config: { min: 1, max: 7 },
  };

  it("maps valid questions to rows with sort_order from position", () => {
    const rows = buildQuestionRows("s1", [base, { ...base, item_code: "q2" }]);
    expect(rows.map((r) => [r.item_code, r.sort_order, r.survey_id])).toEqual([
      ["q1", 0, "s1"],
      ["q2", 1, "s1"],
    ]);
    expect(rows[0].required).toBe(true);
  });

  it("rejects duplicate item codes", () => {
    expect(() => buildQuestionRows("s1", [base, base])).toThrow(/Duplicate item_code "q1"/);
  });

  it("rejects a likert_7 whose range is not 7 points", () => {
    expect(() =>
      buildQuestionRows("s1", [{ ...base, scale_config: { min: 1, max: 5 } }])
    ).toThrow(SurveyValidationError);
  });

  it("accepts a likert with no explicit range (take page falls back)", () => {
    expect(() => buildQuestionRows("s1", [{ ...base, scale_config: {} }])).not.toThrow();
  });

  it("rejects a slider whose max is not above its min", () => {
    expect(() =>
      buildQuestionRows("s1", [
        { ...base, question_type: "slider", scale_config: { min: 5, max: 5 } },
      ])
    ).toThrow(/max must be greater than min/);
  });

  it("requires at least two options for multiple choice", () => {
    expect(() =>
      buildQuestionRows("s1", [
        { ...base, question_type: "multiple_choice", options: ["Only one"] },
      ])
    ).toThrow(/at least two options/);
  });

  it("rejects an invalid item_code", () => {
    expect(() => buildQuestionRows("s1", [{ ...base, item_code: "bad code" }])).toThrow(
      /letters, numbers, or underscores/
    );
  });
});
