import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type SupabaseDouble } from "@/__tests__/support/supabase-double";

/**
 * Self-service personality assessment: scoring and the save / read-own route.
 * player_assessments (migration 006): user_id, assessment_type CHECK IN
 * ('personality','growth_mindset','self_regulation','learning_style'),
 * responses JSONB, scores JSONB, assessed_at.
 */

const h = vi.hoisted(() => ({ user: null as null | { id: string; role: string } }));

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return { createSupabaseServiceClient: async () => m.current().client };
});
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  authLimiter: { check: async () => {} },
  generalLimiter: { check: async () => {} },
}));

import { GET, POST } from "@/app/api/v1/assessments/route";
import { ALL_ITEMS, parseResponses, scoreResponses } from "@/app/api/v1/assessments/scoring";

// TIPI order: E+, A-, C+, N+, O+, E-, A+, C-, N-, O-; then growth mindset -, +, -, +.
const ANSWERS = [7, 1, 6, 6, 5, 2, 7, 2, 3, 4, 2, 6, 1, 7];

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/assessments", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let db: SupabaseDouble;
beforeEach(() => {
  h.user = { id: "me", role: "student" };
  db = installDouble({ player_assessments: [] });
});

describe("scoring", () => {
  it("reverse-codes negative items and averages each dimension on the 1-7 scale", () => {
    const { personality, growth_mindset } = scoreResponses(ANSWERS);
    expect(personality.scores).toEqual({
      extraversion: 6.5, // (7 + (8-2)) / 2
      agreeableness: 7, // ((8-1) + 7) / 2
      conscientiousness: 6, // (6 + (8-2)) / 2
      neuroticism: 5.5, // (6 + (8-3)) / 2 — raw neuroticism, not emotional stability
      openness: 4.5, // (5 + (8-4)) / 2
    });
    expect(growth_mindset.scores).toEqual({ growth_mindset: 6.5 }); // (6 + 6 + 7 + 7) / 4
    expect(personality.responses).toHaveLength(10);
    expect(growth_mindset.responses).toHaveLength(4);
  });

  it("accepts only a complete set of whole numbers from 1 to 7", () => {
    expect(parseResponses(ANSWERS)).toEqual(ANSWERS);
    expect(parseResponses(ANSWERS.slice(1))).toBeNull();
    expect(parseResponses([...ANSWERS.slice(1), 8])).toBeNull();
    expect(parseResponses([...ANSWERS.slice(1), 0])).toBeNull();
    expect(parseResponses([...ANSWERS.slice(1), 3.5])).toBeNull();
    expect(parseResponses([...ANSWERS.slice(1), "4"])).toBeNull();
    expect(parseResponses([...ANSWERS.slice(1), null])).toBeNull();
    expect(parseResponses({ 0: 1 })).toBeNull();
    expect(parseResponses(undefined)).toBeNull();
    expect(ALL_ITEMS).toHaveLength(14);
  });
});

describe("POST /api/v1/assessments", () => {
  it("requires sign-in", async () => {
    h.user = null;
    expect((await POST(req("POST", { responses: ANSWERS }))).status).toBe(401);
    expect(db.table("player_assessments")).toHaveLength(0);
  });

  it("rejects incomplete or out-of-range answers without writing", async () => {
    for (const responses of [undefined, [], ANSWERS.slice(2), ANSWERS.map(() => 9)]) {
      expect((await POST(req("POST", { responses }))).status).toBe(400);
    }
    expect((await POST(req("POST"))).status).toBe(400);
    expect(db.table("player_assessments")).toHaveLength(0);
  });

  it("stores one row per assessment type for the signed-in user, in the shape teams/form reads", async () => {
    const res = await POST(
      // A caller cannot pick whose row is written or what the scores are.
      req("POST", { responses: ANSWERS, user_id: "someone-else", scores: { openness: 7 } })
    );
    expect(res.status).toBe(201);

    const rows = db.table("player_assessments");
    expect(rows.map((r) => r.assessment_type).sort()).toEqual(["growth_mindset", "personality"]);
    expect(rows.every((r) => r.user_id === "me")).toBe(true);

    const personality = rows.find((r) => r.assessment_type === "personality")!;
    // teams/form: `scores as Record<string, number>` on the "personality" row.
    expect(personality.scores).toEqual({
      extraversion: 6.5,
      agreeableness: 7,
      conscientiousness: 6,
      neuroticism: 5.5,
      openness: 4.5,
    });
    expect(Object.values(personality.scores as Record<string, unknown>).every((v) => typeof v === "number")).toBe(true);
    expect(personality.responses).toEqual({ items: ANSWERS.slice(0, 10) });
    expect(rows.find((r) => r.assessment_type === "growth_mindset")!.scores).toEqual({ growth_mindset: 6.5 });

    expect((await res.json()).assessment.scores).toMatchObject({ neuroticism: 5.5, growth_mindset: 6.5 });
  });
});

describe("GET /api/v1/assessments", () => {
  it("requires sign-in", async () => {
    h.user = null;
    expect((await GET(req("GET"))).status).toBe(401);
  });

  it("returns null before the first save", async () => {
    expect(await (await GET(req("GET"))).json()).toEqual({ assessment: null });
  });

  it("returns only the caller's newest results per type", async () => {
    db = installDouble({
      player_assessments: [
        { id: "1", user_id: "me", assessment_type: "personality", scores: { openness: 2, neuroticism: 6 }, assessed_at: "2026-01-01T00:00:00Z" },
        { id: "2", user_id: "me", assessment_type: "personality", scores: { openness: 5, neuroticism: 3 }, assessed_at: "2026-03-01T00:00:00Z" },
        { id: "3", user_id: "me", assessment_type: "growth_mindset", scores: { growth_mindset: 4 }, assessed_at: "2026-02-01T00:00:00Z" },
        { id: "4", user_id: "other", assessment_type: "personality", scores: { openness: 7, neuroticism: 7 }, assessed_at: "2026-04-01T00:00:00Z" },
        { id: "5", user_id: "me", assessment_type: "learning_style", scores: { visual: 1 }, assessed_at: "2026-05-01T00:00:00Z" },
      ],
    });
    expect(await (await GET(req("GET"))).json()).toEqual({
      assessment: {
        scores: { openness: 5, neuroticism: 3, growth_mindset: 4 },
        assessed_at: "2026-03-01T00:00:00Z",
      },
    });
  });

  it("reads back what a retake saved", async () => {
    await POST(req("POST", { responses: ANSWERS }));
    const body = await (await GET(req("GET"))).json();
    expect(body.assessment.scores).toEqual({
      extraversion: 6.5,
      agreeableness: 7,
      conscientiousness: 6,
      neuroticism: 5.5,
      openness: 4.5,
      growth_mindset: 6.5,
    });
  });
});
