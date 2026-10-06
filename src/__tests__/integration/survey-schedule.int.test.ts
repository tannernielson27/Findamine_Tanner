import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

// NOTE: the double returns whole rows whatever select() names. Column names
// read and written here were checked by hand against migration 004:
//   survey_schedules(id, survey_id, trigger_type, trigger_config, active, created_at)
//   surveys(id, title, status, deleted_at)   survey_deliveries/_responses(survey_id)
//   study_enrollments(id, study_id, user_id, withdrawn_at)
//   dimension_assignments(id, user_id, dimension_id, level)
//   treatment_studies(id, current_sample_size)

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});
vi.mock("@/lib/utils/track-event", () => ({ trackEvent: async () => {} }));

import { GET, PUT, DELETE } from "@/app/api/v1/surveys/[id]/schedule/route";
import { POST as withdraw } from "@/app/api/v1/research/withdraw/route";
import { checkBalance } from "@/lib/services/randomization";
import { normalizeSchedules, matchDueTimeSchedules, matchEventSchedules } from "@/lib/services/survey-triggers";
import {
  describeScheduleRows,
  parseScheduleInput,
  summarizeSchedule,
} from "@/app/api/v1/surveys/[id]/schedule/schedule-config";

const AUTH_TOKENS = {
  "tok-admin": { id: "auth-admin" },
  "tok-researcher": { id: "auth-researcher" },
  "tok-teacher": { id: "auth-teacher" },
  "tok-p1": { id: "auth-p1" },
};
const USERS: Row[] = [
  { id: "admin1", auth_id: "auth-admin", role: "admin", deleted_at: null },
  { id: "res1", auth_id: "auth-researcher", role: "researcher", deleted_at: null },
  { id: "teach1", auth_id: "auth-teacher", role: "teacher", deleted_at: null },
  { id: "p1", auth_id: "auth-p1", role: "adult", deleted_at: null, metadata: {} },
];
const SURVEYS: Row[] = [
  { id: "new", title: "New check-in", status: "active", deleted_at: null },
  { id: "t2", title: "Midpoint", status: "draft", deleted_at: null },
];
const T2_ROW: Row = {
  id: "sch-t2",
  survey_id: "t2",
  trigger_type: "time",
  trigger_config: { timepoint: "T2", offset_days: 21, expires_days: 10 },
  active: true,
  created_at: "2026-01-01T00:00:00Z",
};

function install(seed: Record<string, Row[]> = {}): SupabaseDouble {
  return installDouble({ users: USERS, surveys: SURVEYS, ...seed }, { authTokens: AUTH_TOKENS });
}

function req(method: string, token: string | null, body?: unknown, query = ""): NextRequest {
  return new NextRequest(`http://localhost/api/v1/surveys/x/schedule${query}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const at = (id: string) => ({ params: Promise.resolve({ id }) });

const timeBody = (over: Record<string, unknown> = {}, cfg: Record<string, unknown> = {}) => ({
  trigger_type: "time",
  active: true,
  trigger_config: { timepoint: "T4", offset_days: 14, expires_days: 7, ...cfg },
  ...over,
});

describe("schedule-config (pure)", () => {
  it("summarizes in plain language", () => {
    expect(summarizeSchedule(parseScheduleInput(timeBody()))).toBe("Sent 14 days after enrollment, closes after 7 days");
    expect(summarizeSchedule(parseScheduleInput(timeBody({}, { offset_days: 0, expires_days: 1 })))).toBe(
      "Sent at enrollment, closes after 1 day"
    );
    const event = parseScheduleInput({
      trigger_type: "event",
      trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7, fallback: { offset_days: 3 } },
    });
    expect(event.active).toBe(true);
    expect(summarizeSchedule(event)).toBe(
      "Sent the first time a participant opens their privacy settings, or 3 days after enrollment if that never happens; closes after 7 days"
    );
  });

  it.each([
    ["manual trigger", timeBody({ trigger_type: "manual" }), /never delivered/],
    ["completion trigger", timeBody({ trigger_type: "completion" }), /never delivered/],
    ["unknown trigger", timeBody({ trigger_type: "weekly" }), /"time" or "event"/],
    ["missing timepoint", timeBody({}, { timepoint: " " }), /timepoint is required/],
    ["timepoint with spaces", timeBody({}, { timepoint: "T 2" }), /timepoint is required/],
    ["negative offset", timeBody({}, { offset_days: -1 }), /offset_days/],
    ["fractional offset", timeBody({}, { offset_days: 1.5 }), /offset_days/],
    ["string offset", timeBody({}, { offset_days: "14" }), /offset_days/],
    ["zero expiry", timeBody({}, { expires_days: 0 }), /expires_days/],
    ["unknown config key", timeBody({}, { event: "privacy_view" }), /Unknown time trigger_config field: event/],
    ["non-boolean active", timeBody({ active: "yes" }), /active must be/],
    ["array body", [], /JSON object/],
    [
      "event the app never reports",
      { trigger_type: "event", trigger_config: { timepoint: "T1", event: "login", expires_days: 7 } },
      /event must be one of: privacy_view/,
    ],
    [
      "bad fallback",
      { trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7, fallback: { offset_days: 999 } } },
      /fallback\.offset_days/,
    ],
  ])("rejects %s", (_name, body, message) => {
    expect(() => parseScheduleInput(body)).toThrow(message);
  });

  it("reads the seeded T1 pair (event + time fallback, migration 054) as one schedule", () => {
    const described = describeScheduleRows([
      { trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 }, active: true },
      { trigger_type: "time", trigger_config: { timepoint: "T1", offset_days: 3, expires_days: 7, fallback: true }, active: true },
    ]);
    expect(described.unmanaged_rows).toBe(0);
    expect(described.schedule?.trigger_config).toEqual({
      timepoint: "T1",
      event: "privacy_view",
      expires_days: 7,
      fallback: { offset_days: 3 },
    });
  });

  it("does not count a manual row as a schedule", () => {
    expect(describeScheduleRows([{ trigger_type: "manual", trigger_config: {}, active: true }])).toEqual({
      schedule: null,
      unmanaged_rows: 1,
    });
  });
});

describe("/api/v1/surveys/[id]/schedule", () => {
  it("is admin/researcher only", async () => {
    install();
    expect((await GET(req("GET", "tok-unknown"), at("new"))).status).toBe(401);
    expect((await GET(req("GET", "tok-teacher"), at("new"))).status).toBe(403);
    expect((await PUT(req("PUT", "tok-teacher", timeBody()), at("new"))).status).toBe(403);
    expect((await DELETE(req("DELETE", "tok-p1"), at("new"))).status).toBe(403);
    expect((await GET(req("GET", "tok-researcher"), at("new"))).status).toBe(200);
  });

  it("404s for a missing or deleted survey", async () => {
    install({ surveys: [{ id: "gone", title: "x", status: "active", deleted_at: "2026-01-01T00:00:00Z" }] });
    expect((await GET(req("GET", "tok-admin"), at("nope"))).status).toBe(404);
    expect((await PUT(req("PUT", "tok-admin", timeBody()), at("gone"))).status).toBe(404);
  });

  it("reports an unscheduled survey as not delivering", async () => {
    install();
    const body = await (await GET(req("GET", "tok-admin"), at("new"))).json();
    expect(body).toMatchObject({ schedule: null, summary: null, delivering: false, deliveries: 0, responses: 0 });
  });

  it("creates a time schedule the delivery service picks up", async () => {
    const db = install();
    const res = await PUT(req("PUT", "tok-admin", timeBody()), at("new"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      summary: "Sent 14 days after enrollment, closes after 7 days",
      delivering: true,
      schedule: { trigger_type: "time", active: true },
    });

    const rows = db.table("survey_schedules");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      survey_id: "new",
      trigger_type: "time",
      trigger_config: { timepoint: "T4", offset_days: 14, expires_days: 7 },
      active: true,
    });
    // The real matcher, fed exactly what the delivery service selects.
    const normalized = normalizeSchedules([
      { survey_id: "new", trigger_type: "time", trigger_config: rows[0].trigger_config, surveys: { status: "active" } },
    ]);
    expect(matchDueTimeSchedules(normalized, 13)).toHaveLength(0);
    expect(matchDueTimeSchedules(normalized, 14)).toHaveLength(1);
  });

  it("stores an event schedule with its fallback as two rows, and replaces rather than appends", async () => {
    const db = install();
    await PUT(req("PUT", "tok-admin", timeBody()), at("new"));
    const res = await PUT(
      req("PUT", "tok-admin", {
        trigger_type: "event",
        active: false,
        trigger_config: { timepoint: "T4", event: "privacy_view", expires_days: 5, fallback: { offset_days: 3 } },
      }),
      at("new")
    );
    expect(res.status).toBe(200);
    expect((await res.json()).delivering).toBe(false);

    const rows = db.table("survey_schedules");
    expect(rows.map((r) => [r.trigger_type, r.trigger_config, r.active])).toEqual([
      ["event", { timepoint: "T4", event: "privacy_view", expires_days: 5 }, false],
      ["time", { timepoint: "T4", offset_days: 3, expires_days: 5, fallback: true }, false],
    ]);
    const normalized = normalizeSchedules(
      rows.map((r) => ({ survey_id: "new", trigger_type: String(r.trigger_type), trigger_config: r.trigger_config, surveys: { status: "active" } }))
    );
    expect(matchEventSchedules(normalized, "privacy_view")).toHaveLength(1);
  });

  it("rejects an invalid body with 400 and writes nothing", async () => {
    const db = install();
    const res = await PUT(req("PUT", "tok-admin", timeBody({ trigger_type: "manual" })), at("new"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/never delivered/);
    expect(db.table("survey_schedules")).toHaveLength(0);
  });

  it("refuses a second ACTIVE schedule on a timepoint another survey holds, even when confirmed", async () => {
    const db = install({ survey_schedules: [T2_ROW] });
    const res = await PUT(req("PUT", "tok-admin", timeBody({ confirm: true }, { timepoint: "t2" })), at("new"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("timepoint_conflict");
    expect(body.error).toMatch(/"Midpoint" \(draft\)/);
    expect(body.conflicts).toEqual([{ survey_id: "t2", title: "Midpoint", survey_status: "draft", schedule_active: true }]);
    expect(db.table("survey_schedules")).toHaveLength(1);
  });

  it("asks before sharing a timepoint with a switched-off schedule, then saves on confirm", async () => {
    const db = install({ survey_schedules: [{ ...T2_ROW, active: false }] });
    const first = await PUT(req("PUT", "tok-admin", timeBody({}, { timepoint: "T2" })), at("new"));
    expect(first.status).toBe(409);
    const body = await first.json();
    expect(body.code).toBe("confirmation_required");
    expect(body.warnings.join(" ")).toMatch(/also used by "Midpoint"/);
    expect(db.table("survey_schedules")).toHaveLength(1);

    const second = await PUT(req("PUT", "tok-admin", timeBody({ confirm: true }, { timepoint: "T2" })), at("new"));
    expect(second.status).toBe(200);
    expect(db.table("survey_schedules")).toHaveLength(2);
  });

  it("warns before changing a schedule that already has deliveries or responses", async () => {
    const db = install({
      survey_schedules: [{ ...T2_ROW, id: "sch-new", survey_id: "new", trigger_config: { timepoint: "T4", offset_days: 14, expires_days: 7 } }],
      survey_deliveries: [
        { id: "d1", survey_id: "new", user_id: "p1", status: "submitted" },
        { id: "d2", survey_id: "new", user_id: "p2", status: "pending" },
      ],
      survey_responses: [{ id: "r1", survey_id: "new", user_id: "p1", delivery_id: "d1" }],
    });

    // Re-saving the identical schedule is a no-op and needs no confirmation.
    const same = await PUT(req("PUT", "tok-admin", timeBody()), at("new"));
    expect(same.status).toBe(200);
    expect(db.table("survey_schedules")[0].id).toBe("sch-new");

    const changed = timeBody({}, { offset_days: 21 });
    const first = await PUT(req("PUT", "tok-admin", changed), at("new"));
    expect(first.status).toBe(409);
    const body = await first.json();
    expect(body.code).toBe("confirmation_required");
    expect(body.warnings[0]).toMatch(/2 deliveries and 1 response/);
    expect((db.table("survey_schedules")[0].trigger_config as Row).offset_days).toBe(14);

    const second = await PUT(req("PUT", "tok-admin", { ...changed, confirm: true }), at("new"));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ deliveries: 2, responses: 1 });
    const rows = db.table("survey_schedules");
    expect(rows).toHaveLength(1);
    expect((rows[0].trigger_config as Row).offset_days).toBe(21);
    // Existing deliveries are left alone.
    expect(db.table("survey_deliveries").map((d) => d.status)).toEqual(["submitted", "pending"]);
  });

  it("DELETE removes every row for the survey, asking first when data exists", async () => {
    const db = install({
      survey_schedules: [
        T2_ROW,
        { id: "a", survey_id: "new", trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 }, active: true },
        { id: "b", survey_id: "new", trigger_type: "time", trigger_config: { timepoint: "T1", offset_days: 3, expires_days: 7, fallback: true }, active: true },
      ],
      survey_deliveries: [{ id: "d1", survey_id: "new", user_id: "p1", status: "pending" }],
    });
    const first = await DELETE(req("DELETE", "tok-admin"), at("new"));
    expect(first.status).toBe(409);
    expect((await first.json()).code).toBe("confirmation_required");
    expect(db.table("survey_schedules")).toHaveLength(3);

    const second = await DELETE(req("DELETE", "tok-admin", undefined, "?confirm=true"), at("new"));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ schedule: null, removed: 2, delivering: false });
    expect(db.table("survey_schedules").map((r) => r.id)).toEqual(["sch-t2"]);
  });

  it("DELETE on an unscheduled survey is a harmless no-op", async () => {
    install();
    const res = await DELETE(req("DELETE", "tok-admin"), at("new"));
    expect(res.status).toBe(200);
    expect((await res.json()).removed).toBe(0);
  });
});

describe("checkBalance", () => {
  const DESIGN: Record<string, Row[]> = {
    treatment_dimensions: [{ id: "dim1", name: "privacy_default", levels: ["private", "public"] }],
    treatment_study_dimensions: [{ study_id: "s1", dimension_id: "dim1", active_levels: null }],
  };

  it("counts only this study's currently enrolled participants", async () => {
    installDouble({
      ...DESIGN,

      study_enrollments: [
        { id: "e1", study_id: "s1", user_id: "a", withdrawn_at: null },
        { id: "e2", study_id: "s1", user_id: "b", withdrawn_at: null },
        { id: "e3", study_id: "s1", user_id: "gone", withdrawn_at: "2026-09-01T00:00:00Z" },
        { id: "e4", study_id: "other", user_id: "elsewhere", withdrawn_at: null },
      ],
      dimension_assignments: [
        { id: "a1", user_id: "a", dimension_id: "dim1", level: "private" },
        { id: "a2", user_id: "b", dimension_id: "dim1", level: "public" },
        { id: "a3", user_id: "gone", dimension_id: "dim1", level: "public" },
        { id: "a4", user_id: "elsewhere", dimension_id: "dim1", level: "public" },
        { id: "a5", user_id: "a", dimension_id: "unrelated", level: "private" },
      ],
    });
    expect(await checkBalance("s1")).toEqual({
      balanced: true,
      cells: [
        { dimension: "privacy_default", level: "private", count: 1 },
        { dimension: "privacy_default", level: "public", count: 1 },
      ],
    });
  });

  it("counts past the 1000-row PostgREST cap", async () => {
    const enrollments: Row[] = [];
    const assignments: Row[] = [];
    for (let i = 0; i < 2400; i++) {
      const n = String(i).padStart(5, "0");
      enrollments.push({ id: `e${n}`, study_id: "s1", user_id: `u${n}`, withdrawn_at: null });
      assignments.push({ id: `a${n}`, user_id: `u${n}`, dimension_id: "dim1", level: i % 2 ? "public" : "private" });
    }
    installDouble({
      ...DESIGN,

      study_enrollments: enrollments,
      dimension_assignments: assignments,
    });
    const { balanced, cells } = await checkBalance("s1");
    expect(cells.map((c) => c.count)).toEqual([1200, 1200]);
    expect(balanced).toBe(true);
  });
});

describe("POST /api/v1/research/withdraw", () => {
  it("refreshes current_sample_size for the study withdrawn from", async () => {
    const db = install({
      treatment_studies: [
        { id: "s1", study_code: "pilot", current_sample_size: 3 },
        { id: "s2", study_code: "other", current_sample_size: 9 },
      ],
      study_enrollments: [
        { id: "e1", study_id: "s1", user_id: "p1", withdrawn_at: null },
        { id: "e2", study_id: "s1", user_id: "p2", withdrawn_at: null },
        { id: "e3", study_id: "s1", user_id: "p3", withdrawn_at: null },
      ],
    });
    const res = await withdraw(
      new NextRequest("http://localhost/api/v1/research/withdraw", {
        method: "POST",
        headers: { authorization: "Bearer tok-p1" },
      })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "withdrawn", withdrawn: 1 });
    const studies = db.table("treatment_studies");
    expect(studies.find((s) => s.id === "s1")?.current_sample_size).toBe(2);
    expect(studies.find((s) => s.id === "s2")?.current_sample_size).toBe(9);
  });
});
