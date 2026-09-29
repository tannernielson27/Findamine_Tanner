import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

type Result = { data: unknown; error: unknown };

/** A chainable stand-in for one PostgREST query that resolves to `result`. */
function query(result: Result) {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "insert", "update", "delete", "eq", "in", "is", "order"]) {
    q[m] = vi.fn(() => q);
  }
  q.single = vi.fn(async () => result);
  q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return q;
}

const h = vi.hoisted(() => ({
  service: null as unknown as { from: ReturnType<typeof vi.fn> },
  user: null as null | { id: string; role: string },
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: async () => h.service,
}));
vi.mock("@/lib/utils/api-auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils/api-auth")>()),
  getAuthUser: async () => h.user,
}));

import { GET as listSurveys, POST as createSurvey } from "@/app/api/v1/surveys/route";
import { PUT as putQuestions } from "@/app/api/v1/surveys/[id]/questions/route";

/** Queue one result per `from(table)` call, in call order. */
function install(queue: Record<string, Result[]>) {
  const made: Record<string, ReturnType<typeof query>[]> = {};
  h.service = {
    from: vi.fn((table: string) => {
      const q = query(queue[table]?.shift() ?? { data: null, error: null });
      (made[table] ||= []).push(q);
      return q;
    }),
  };
  return made;
}

function req(method: string, path: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "s1" }) };
const question = {
  item_code: "q1",
  question_text: "How are you?",
  question_type: "likert_5",
  scale_config: { min: 1, max: 5 },
};

beforeEach(() => {
  h.user = { id: "u1", role: "researcher" };
});

describe("POST /api/v1/surveys", () => {
  it("rejects a blank title with 400 instead of a database error", async () => {
    install({});
    const res = await createSurvey(req("POST", "/api/v1/surveys", { title: "   " }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Title is required");
  });

  it("returns 403 with a reason for a teacher", async () => {
    h.user = { id: "u1", role: "teacher" };
    install({});
    const res = await createSurvey(req("POST", "/api/v1/surveys", { title: "X" }));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/surveys", () => {
  it("does not list surveys to teachers, who cannot edit them", async () => {
    h.user = { id: "u1", role: "teacher" };
    install({});
    const res = await listSurveys(req("GET", "/api/v1/surveys"));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/v1/surveys/[id]/questions", () => {
  it("returns 400 for a likert_7 with a 5-point range and touches nothing", async () => {
    const made = install({});
    const res = await putQuestions(
      req("PUT", "/api/v1/surveys/s1/questions", {
        questions: [{ ...question, question_type: "likert_7" }],
      }),
      params
    );
    expect(res.status).toBe(400);
    expect(made.survey_questions).toBeUndefined();
  });

  it("keeps the old questions when the insert fails", async () => {
    const made = install({
      surveys: [{ data: { id: "s1" }, error: null }],
      survey_questions: [
        { data: [{ id: "old1" }], error: null }, // read existing
        { data: null, error: { message: "insert failed" } }, // insert
      ],
    });
    const res = await putQuestions(
      req("PUT", "/api/v1/surveys/s1/questions", { questions: [question] }),
      params
    );
    expect(res.status).toBe(500);
    expect(made.survey_questions).toHaveLength(2);
    expect(made.survey_questions.some((q) => (q.delete as ReturnType<typeof vi.fn>).mock.calls.length)).toBe(false);
  });

  it("inserts the new set, then deletes only the old rows by id", async () => {
    const made = install({
      surveys: [{ data: { id: "s1" }, error: null }],
      survey_questions: [
        { data: [{ id: "old1" }, { id: "old2" }], error: null },
        { data: [{ id: "new1" }], error: null },
        { data: null, error: null },
      ],
    });
    const res = await putQuestions(
      req("PUT", "/api/v1/surveys/s1/questions", { questions: [question] }),
      params
    );
    expect(res.status).toBe(200);
    const [, insertQ, deleteQ] = made.survey_questions;
    expect(insertQ.insert).toHaveBeenCalled();
    expect(deleteQ.delete).toHaveBeenCalled();
    expect(deleteQ.in).toHaveBeenCalledWith("id", ["old1", "old2"]);
  });

  it("rolls back the new rows when deleting the old ones fails", async () => {
    const made = install({
      surveys: [{ data: { id: "s1" }, error: null }],
      survey_questions: [
        { data: [{ id: "old1" }], error: null },
        { data: [{ id: "new1" }], error: null },
        { data: null, error: { message: "delete failed" } },
        { data: null, error: null },
      ],
    });
    const res = await putQuestions(
      req("PUT", "/api/v1/surveys/s1/questions", { questions: [question] }),
      params
    );
    expect(res.status).toBe(500);
    expect(made.survey_questions[3].in).toHaveBeenCalledWith("id", ["new1"]);
  });
});
