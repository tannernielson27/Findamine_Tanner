import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The creator-facing generators must never hand back canned filler as if the
 * model had written it. No real AI API is called: both SDKs are mocked.
 */

const h = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: h.create } };
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() };
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => ({}),
}));

import { generateClueWithHints, generateModule, recommendHunt } from "@/lib/services/findbot";

const reply = (json: unknown) => ({ choices: [{ message: { content: JSON.stringify(json) } }] });

const huntSpec = {
  subject_domains: ["science_nature"], grade_band: "3-5", target_audience: "kids",
  location_type: "any", target_duration_min: 40, difficulty_progression: "ascending", num_stops: 2,
};
const task = (id: string) => ({
  id, title: id, subject_domain: "science_nature", tags: [], challenge_type: "short_text",
  difficulty_rating: 3, location_type: "any", estimated_minutes: 5,
});
const primer = (id: string) => ({
  id, title: id, subject_domain: "science_nature", tags: [], difficulty_rating: 3, location_type: "any",
});

beforeEach(() => {
  h.create.mockReset();
});

describe("when the AI call fails", () => {
  beforeEach(() => {
    h.create.mockRejectedValue(new Error("no api key"));
  });

  it("recommendHunt rejects instead of returning an empty 'Custom Hunt'", async () => {
    await expect(
      recommendHunt({ availableTasks: [task("t1")], availablePrimers: [], huntSpec })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("generateClueWithHints rejects instead of 'Head to the next location!'", async () => {
    await expect(
      generateClueWithHints({ primerContent: {}, taskContent: { question: "Q" }, difficultyTier: "medium" })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("generateModule rejects instead of 'Learn about <topic>.'", async () => {
    await expect(
      generateModule({
        subject: "science_nature", gradeBand: "3-5", challengeType: "short_text",
        difficultyTier: "medium", locationType: "any", topic: "Erosion",
      })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("when the AI answers", () => {
  it("recommendHunt drops stops whose task was never offered, and renumbers", async () => {
    h.create.mockResolvedValue(reply({
      title: "Stream Detectives", description: "d", theme_narrative: "n",
      stops: [
        { task_id: "invented", primer_id: "p1", sort_order: 0, suggested_clue: "c0", clue_hints: [] },
        { task_id: "t2", primer_id: "invented", sort_order: 7, suggested_clue: "c1", clue_hints: ["a", "", "b"] },
        { task_id: "t1", primer_id: "p1", sort_order: 7, suggested_clue: "c2", clue_hints: [] },
      ],
    }));

    const result = await recommendHunt({
      availableTasks: [task("t1"), task("t2")], availablePrimers: [primer("p1")], huntSpec,
    });

    expect(result.title).toBe("Stream Detectives");
    expect(result.stops).toEqual([
      { task_id: "t2", primer_id: "", sort_order: 0, suggested_clue: "c1", clue_hints: ["a", "b"] },
      { task_id: "t1", primer_id: "p1", sort_order: 1, suggested_clue: "c2", clue_hints: [] },
    ]);
  });

  it("recommendHunt rejects a reply with no usable stops", async () => {
    h.create.mockResolvedValue(reply({ title: "Empty", description: "", theme_narrative: "", stops: [] }));
    await expect(
      recommendHunt({ availableTasks: [task("t1")], availablePrimers: [], huntSpec })
    ).rejects.toMatchObject({ statusCode: 503 });
  });

  it("generateClueWithHints returns the model's clue, and rejects an empty one", async () => {
    h.create.mockResolvedValueOnce(reply({ clue_text: "Where water sings", clue_hints: ["h1", "h2", "h3", "h4"] }));
    await expect(
      generateClueWithHints({ primerContent: {}, taskContent: { question: "Q" }, difficultyTier: "easy" })
    ).resolves.toEqual({ clue_text: "Where water sings", clue_hints: ["h1", "h2", "h3"] });

    h.create.mockResolvedValueOnce(reply({ clue_hints: ["h1"] }));
    await expect(
      generateClueWithHints({ primerContent: {}, taskContent: { question: "Q" }, difficultyTier: "easy" })
    ).rejects.toMatchObject({ statusCode: 503 });
  });
});
