import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});
vi.mock("@/lib/utils/rate-limit", () => {
  const open = { check: async () => {} };
  return { generalLimiter: open };
});

import { GET } from "@/app/api/v1/curriculum/route";

const PLAYER = "bearer-player";
const TEACHER = "bearer-teacher";

const TASK = {
  id: "t1",
  is_library: true,
  deleted_at: null,
  subject_domain: "math",
  grade_range_min: 3,
  challenge_type: "multiple_choice",
  content: { question: "2+2?", options: ["3", "4"], correct_answer: "4", partial_answers: ["four"] },
};

function seed() {
  const user = (id: string, role: string) => ({
    id, auth_id: `auth-${id}`, role, status: "active", deleted_at: null,
  });
  installDouble(
    {
      tasks: [TASK],
      education_standards: [{ id: "std1", code: "MATH.3.OA" }],
      task_standard_alignments: [{ task_id: "t1", standard_id: "std1", alignment_strength: "primary" }],
      users: [user("p1", "teen"), user("te1", "teacher")],
      user_profiles: [],
    },
    {
      authTokens: { [PLAYER]: { id: "auth-p1" }, [TEACHER]: { id: "auth-te1" } },
      embeds: { task_standard_alignments: { tasks: { table: "tasks", localKey: "task_id" } } },
    }
  );
}

async function tasksFrom(query: string, token?: string) {
  const res = await GET(
    new NextRequest(`http://localhost/api/v1/curriculum${query}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
  );
  expect(res.status).toBe(200);
  return (await res.json()).tasks as Array<{ content: Record<string, unknown> }>;
}

describe("curriculum library hides answer keys from non-authors", () => {
  beforeEach(() => {
    // The signed-out path builds a cookie client; with no cookies it never calls out.
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "test-anon-key";
    seed();
  });

  for (const query of ["", "?standard=MATH.3.OA"]) {
    it(`strips keys for signed-out visitors (${query || "default"})`, async () => {
      const [task] = await tasksFrom(query);
      expect(task.content.question).toBe("2+2?");
      expect(task.content).not.toHaveProperty("correct_answer");
      expect(task.content).not.toHaveProperty("partial_answers");
    });

    it(`strips keys for players (${query || "default"})`, async () => {
      const [task] = await tasksFrom(query, PLAYER);
      expect(task.content).not.toHaveProperty("correct_answer");
    });

    it(`keeps keys for hunt authors (${query || "default"})`, async () => {
      const [task] = await tasksFrom(query, TEACHER);
      expect(task.content.correct_answer).toBe("4");
    });
  }
});
