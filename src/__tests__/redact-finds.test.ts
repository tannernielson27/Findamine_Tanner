import { describe, it, expect } from "vitest";
import { canSeeAnswerKeys, redactAnswerKeys } from "@/app/api/v1/hunts/redact-finds";

describe("canSeeAnswerKeys", () => {
  it("allows the hunt owner, admins and researchers", () => {
    expect(canSeeAnswerKeys({ id: "u1", role: "teacher" }, "u1")).toBe(true);
    expect(canSeeAnswerKeys({ id: "u2", role: "admin" }, "u1")).toBe(true);
    expect(canSeeAnswerKeys({ id: "u2", role: "researcher" }, "u1")).toBe(true);
  });

  it("refuses players, other teachers and anonymous viewers", () => {
    expect(canSeeAnswerKeys({ id: "u2", role: "adult" }, "u1")).toBe(false);
    expect(canSeeAnswerKeys({ id: "u2", role: "teacher" }, "u1")).toBe(false);
    expect(canSeeAnswerKeys(null, "u1")).toBe(false);
  });
});

describe("redactAnswerKeys", () => {
  it("removes answer keys but keeps what the player needs", () => {
    const finds = [
      {
        id: "f1",
        tasks: {
          title: "Quiz",
          content: {
            question: "2+3?",
            options: ["4", "5"],
            correct_answer: "5",
            partial_answers: { "4": 0.5 },
          },
        },
      },
    ];

    const [redacted] = redactAnswerKeys(finds);

    expect(redacted.tasks.content).toEqual({ question: "2+3?", options: ["4", "5"] });
    expect(redacted.tasks.title).toBe("Quiz");
    // Input is not mutated.
    expect(finds[0].tasks.content.correct_answer).toBe("5");
  });

  it("does not reveal the order of sorting items", () => {
    const [redacted] = redactAnswerKeys([
      { tasks: { content: { items: ["c", "a", "b"], correct_order: ["c", "a", "b"] } } },
    ]);

    expect(redacted.tasks.content).toEqual({ items: ["a", "b", "c"] });
  });

  it("passes through finds with no task", () => {
    const finds = [{ id: "f1", tasks: null }];
    expect(redactAnswerKeys(finds)).toEqual(finds);
  });
});
