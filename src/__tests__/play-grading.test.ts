import { describe, it, expect } from "vitest";
import { gradeAnswer } from "@/app/api/v1/play/_lib/grading";

describe("gradeAnswer: open-ended tasks", () => {
  it("treats correct_answer: null (what the editor stores) as open-ended", () => {
    const task = { challenge_type: "short_text", content: { question: "What do you see?", correct_answer: null } };
    expect(gradeAnswer(task, "A red door")).toEqual({ isCorrect: true, openEnded: true });
  });

  it("never compares the answer to the string 'null'", () => {
    const task = { challenge_type: "creative_writing", content: { correct_answer: null } };
    expect(gradeAnswer(task, "anything at all").isCorrect).toBe(true);
  });

  it("treats a missing or blank key, or a missing task, as open-ended", () => {
    expect(gradeAnswer({ content: {} }, "x").openEnded).toBe(true);
    expect(gradeAnswer({ content: { correct_answer: "  " } }, "x").isCorrect).toBe(true);
    expect(gradeAnswer(null, "[sketch:1234chars]")).toEqual({ isCorrect: true, openEnded: true });
  });

  it("does not accept a blank submission", () => {
    const task = { content: { correct_answer: null } };
    expect(gradeAnswer(task, "   ")).toEqual({ isCorrect: false, openEnded: true });
    expect(gradeAnswer(task, "")).toEqual({ isCorrect: false, openEnded: true });
  });
});

describe("gradeAnswer: keyed tasks", () => {
  it("matches text ignoring case and surrounding space", () => {
    const task = { challenge_type: "multiple_choice", content: { correct_answer: "Oak Tree" } };
    expect(gradeAnswer(task, "  oak tree ").isCorrect).toBe(true);
    expect(gradeAnswer(task, "maple").isCorrect).toBe(false);
    expect(gradeAnswer(task, "maple").openEnded).toBe(false);
  });

  it("compares numeric answers numerically", () => {
    const task = { challenge_type: "numeric_entry", content: { correct_answer: "5" } };
    expect(gradeAnswer(task, "5.0").isCorrect).toBe(true);
    expect(gradeAnswer(task, "05").isCorrect).toBe(true);
    expect(gradeAnswer(task, 5).isCorrect).toBe(true);
    expect(gradeAnswer(task, "6").isCorrect).toBe(false);
    expect(gradeAnswer({ content: { correct_answer: 2.5 } }, "2.50").isCorrect).toBe(true);
  });

  it("does not treat non-numeric text as a number", () => {
    const task = { content: { correct_answer: "5 trees" } };
    expect(gradeAnswer(task, "5").isCorrect).toBe(false);
    expect(gradeAnswer(task, "5 Trees").isCorrect).toBe(true);
  });

  it("gives partial credit from partial_answers", () => {
    const task = { content: { correct_answer: "oak", partial_answers: { tree: 0.4 } } };
    expect(gradeAnswer(task, "Tree")).toEqual({ isCorrect: false, partialCredit: 0.4, openEnded: false });
  });
});

describe("gradeAnswer: ordering tasks", () => {
  const task = {
    challenge_type: "sorting_ordering",
    content: { items: ["Seed", "Sprout", "Tree"], correct_order: ["Seed", "Sprout", "Tree"] },
  };

  it("accepts the correct order as the comma-joined string the client sends", () => {
    expect(gradeAnswer(task, "Seed,Sprout,Tree")).toEqual({ isCorrect: true, openEnded: false });
    expect(gradeAnswer(task, "seed, sprout ,TREE").isCorrect).toBe(true);
  });

  it("rejects a wrong order, with partial credit for items in place", () => {
    const result = gradeAnswer(task, "Seed,Tree,Sprout");
    expect(result.isCorrect).toBe(false);
    expect(result.partialCredit).toBeCloseTo(1 / 3);
    expect(gradeAnswer(task, "Tree,Seed,Sprout").partialCredit).toBeUndefined();
  });

  it("handles items that contain commas", () => {
    const commaTask = { content: { correct_order: ["Salt Lake City, UT", "Provo, UT"] } };
    expect(gradeAnswer(commaTask, "Salt Lake City, UT,Provo, UT").isCorrect).toBe(true);
    expect(gradeAnswer(commaTask, "Provo, UT,Salt Lake City, UT").isCorrect).toBe(false);
  });
});
