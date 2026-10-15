import { describe, it, expect } from "vitest";
import { nextFlowDirection, type FlowDirectionState } from "@/lib/motion";

const start: FlowDirectionState = { key: "prime", position: 0, direction: 1 };

describe("nextFlowDirection", () => {
  it("returns the same state object when the key is unchanged", () => {
    expect(nextFlowDirection(start, "prime", 42)).toBe(start);
  });

  it("moves forward when the new position is later", () => {
    expect(nextFlowDirection(start, "clue", 1)).toEqual({ key: "clue", position: 1, direction: 1 });
  });

  it("moves back when the new position is earlier", () => {
    const at = { key: "challenge", position: 103, direction: 1 } as const;
    expect(nextFlowDirection(at, "feedback", 5).direction).toBe(-1);
  });

  it("ignores intermediate positions recorded without a key change", () => {
    // Stop 0 feedback (pos 5) → index bumps first (pos 105, same key) → prime of stop 1 (pos 100).
    const feedback: FlowDirectionState = { key: "feedback", position: 5, direction: 1 };
    const intermediate = nextFlowDirection(feedback, "feedback", 105);
    expect(nextFlowDirection(intermediate, "prime", 100).direction).toBe(1);
  });
});
