import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Ownership and field whitelisting for the generic task/primer CRUD routes.
 * The service client bypasses RLS, so the helper is the only access control.
 */

type Result = { data: unknown; error: unknown };
type Query = Record<string, ReturnType<typeof vi.fn>> & { then: unknown };

function query(result: Result): Query {
  const q = {} as Query;
  for (const m of ["select", "insert", "update", "delete", "eq", "is", "order", "limit"]) {
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

import { POST as createTask } from "@/app/api/v1/tasks/route";
import { PUT as updateTask, DELETE as deleteTask } from "@/app/api/v1/tasks/[id]/route";
import { POST as createPrimer } from "@/app/api/v1/primers/route";
import { PUT as updatePrimer } from "@/app/api/v1/primers/[id]/route";

/** Queue one result per `from()` call, in call order; returns the queries made. */
function install(results: Result[]): Query[] {
  const made: Query[] = [];
  h.service = {
    from: vi.fn(() => {
      const q = query(results.shift() ?? { data: null, error: null });
      made.push(q);
      return q;
    }),
  };
  return made;
}

function req(method: string, body?: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/v1/tasks/t1", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "t1" }) };
const ok = (data: unknown): Result => ({ data, error: null });

beforeEach(() => {
  h.user = { id: "teacher-1", role: "teacher" };
});

describe("PUT /tasks/[id] ownership", () => {
  it("refuses to edit another teacher's task and writes nothing", async () => {
    const made = install([ok({ created_by: "teacher-2" })]);
    const res = await updateTask(req("PUT", { title: "Hijacked" }), params);
    expect(res.status).toBe(403);
    expect(made).toHaveLength(1);
    expect(made[0].update).not.toHaveBeenCalled();
  });

  it("keeps library rows without a creator read-only for teachers", async () => {
    const made = install([ok({ created_by: null })]);
    const res = await updateTask(req("PUT", { title: "Edited library task" }), params);
    expect(res.status).toBe(403);
    expect(made).toHaveLength(1);
  });

  it("lets the owner edit, writing only whitelisted fields", async () => {
    const made = install([ok({ created_by: "teacher-1" }), ok({ id: "t1", title: "New" })]);
    const res = await updateTask(
      req("PUT", { title: "New", created_by: "teacher-9", deleted_at: null, id: "other", points: 999 }),
      params
    );
    expect(res.status).toBe(200);
    expect(made[1].update).toHaveBeenCalledWith({ title: "New" });
  });

  it("lets an admin edit anyone's task", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install([ok({ created_by: "teacher-2" }), ok({ id: "t1" })]);
    const res = await updateTask(req("PUT", { title: "Moderated", is_library: true }), params);
    expect(res.status).toBe(200);
    expect(made[1].update).toHaveBeenCalledWith({ title: "Moderated", is_library: true });
  });

  it("returns 404 for a missing or deleted task", async () => {
    install([ok(null)]);
    expect((await updateTask(req("PUT", { title: "x" }), params)).status).toBe(404);
  });

  it("rejects a body with no updatable fields before touching the database", async () => {
    const made = install([]);
    const res = await updateTask(req("PUT", { created_by: "teacher-1" }), params);
    expect(res.status).toBe(400);
    expect(made).toHaveLength(0);
  });

  it("rejects a student outright", async () => {
    h.user = { id: "kid-1", role: "teen" };
    install([]);
    expect((await updateTask(req("PUT", { title: "x" }), params)).status).toBe(403);
  });

  it("applies the same rule to primers", async () => {
    install([ok({ created_by: "teacher-2" })]);
    expect((await updatePrimer(req("PUT", { title: "x" }), params)).status).toBe(403);
  });
});

describe("DELETE /tasks/[id] ownership", () => {
  it("refuses to delete another teacher's task", async () => {
    const made = install([ok({ created_by: "teacher-2" })]);
    expect((await deleteTask(req("DELETE"), params)).status).toBe(403);
    expect(made).toHaveLength(1);
  });

  it("soft-deletes the owner's task", async () => {
    const made = install([ok({ created_by: "teacher-1" }), ok(null)]);
    expect((await deleteTask(req("DELETE"), params)).status).toBe(200);
    expect(made[1].update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
  });
});

describe("the shared-library flag", () => {
  it.each([true, "true", 1, "1", "yes", {}])(
    "a teacher cannot set is_library=%j on update",
    async (value) => {
      const made = install([ok({ created_by: "teacher-1" }), ok({ id: "t1" })]);
      const res = await updateTask(req("PUT", { title: "Mine", is_library: value }), params);
      expect([400, 403]).toContain(res.status);
      expect(made).toHaveLength(0);
    }
  );

  it.each([true, "true", 1, "1"])("a teacher cannot set is_library=%j on create", async (value) => {
    const made = install([ok({ id: "t1" })]);
    const res = await createTask(req("POST", { title: "Mine", challenge_type: "short_text", is_library: value }));
    expect([400, 403]).toContain(res.status);

    const primer = await createPrimer(req("POST", { title: "Mine", is_library: value }));
    expect([400, 403]).toContain(primer.status);
    expect(made).toHaveLength(0);
  });

  it("answers a non-boolean with 400 and a boolean true with 403", async () => {
    install([]);
    expect((await updateTask(req("PUT", { is_library: "true" }), params)).status).toBe(400);
    expect((await updateTask(req("PUT", { is_library: 1 }), params)).status).toBe(400);
    expect((await updateTask(req("PUT", { is_library: true }), params)).status).toBe(403);
  });

  it("rejects a non-boolean even from an admin", async () => {
    h.user = { id: "admin-1", role: "admin" };
    const made = install([]);
    expect((await updateTask(req("PUT", { is_library: "true" }), params)).status).toBe(400);
    expect(made).toHaveLength(0);
  });

  it("lets a teacher create an ordinary task, stamped as theirs", async () => {
    const made = install([ok({ id: "t1" })]);
    const res = await createTask(
      req("POST", { title: "Mine", challenge_type: "short_text", is_library: false, created_by: "teacher-9" })
    );
    expect(res.status).toBe(201);
    expect(made[0].insert).toHaveBeenCalledWith({
      title: "Mine",
      challenge_type: "short_text",
      is_library: false,
      created_by: "teacher-1",
    });
  });
});
