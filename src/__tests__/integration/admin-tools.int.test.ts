import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, daysAgo, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

// NOTE: the double returns whole rows whatever select() names, so these tests
// pin behaviour and the column names WRITTEN; column names READ were checked by
// hand against supabase/migrations.

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});
vi.mock("@/lib/utils/rate-limit", () => {
  const limiter = { check: async () => {}, checkKey: async () => {} };
  return { authLimiter: limiter, socialLimiter: limiter, generalLimiter: limiter };
});

import { POST as postReport } from "@/app/api/v1/reports/route";
import { GET as listReports } from "@/app/api/v1/moderation/route";
import { POST as reviewReport } from "@/app/api/v1/moderation/[id]/review/route";
import { PUT as putUser } from "@/app/api/v1/admin/users/[id]/route";
import { GET as getParticipants } from "@/app/api/v1/research/participants/route";
import { POST as blockIp } from "@/app/api/v1/admin/block-ip/route";
import { POST as labelThreat } from "@/app/api/v1/admin/label-threat/route";
import { GET as threatExport } from "@/app/api/v1/admin/threat-export/route";
import { GET as threatSessions } from "@/app/api/v1/admin/threat-sessions/route";
import { GET as reengagementCron } from "@/app/api/cron/reengagement/route";
import { getStudyHealth } from "@/lib/services/research-dashboard";

const UUID = "11111111-1111-4111-8111-111111111111";
const AUTH_TOKENS = {
  "tok-admin": { id: "auth-admin" },
  "tok-researcher": { id: "auth-researcher" },
  "tok-player": { id: "auth-player" },
};
const USERS: Row[] = [
  { id: "admin1", auth_id: "auth-admin", role: "admin", status: "active", email: "admin@example.edu", deleted_at: null },
  { id: "res1", auth_id: "auth-researcher", role: "researcher", status: "active", email: "res@example.edu", deleted_at: null },
  { id: "player1", auth_id: "auth-player", role: "adult", status: "active", email: "p.one@example.edu", deleted_at: null },
];

function install(seed: Record<string, Row[]> = {}, opts: Parameters<typeof installDouble>[1] = {}): SupabaseDouble {
  return installDouble({ users: USERS, ...seed }, { authTokens: AUTH_TOKENS, ...opts });
}

function req(method: string, path: string, token: string | null, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe("POST /api/v1/reports", () => {
  it("stores the play page's report under the real moderation_reports columns", async () => {
    const db = install();
    const res = await postReport(
      req("POST", "/api/v1/reports", "tok-player", { category: "spam", target_type: "find", target_id: UUID })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).reported).toBe(true);

    const [row] = db.table("moderation_reports");
    expect(row).toMatchObject({
      reporter_id: "player1",
      entity_type: "content", // "find" is not in the entity_type CHECK
      entity_id: UUID,
      reason: "spam",
      details: "[find]",
      status: "pending",
    });
    for (const wrong of ["target_type", "target_id", "category", "description"]) {
      expect(row).not.toHaveProperty(wrong);
    }
  });

  it("keeps an allowed entity type and the reporter's comment", async () => {
    const db = install();
    await postReport(
      req("POST", "/api/v1/reports", "tok-player", {
        category: "mean_hurtful",
        target_type: "wall_post",
        target_id: UUID,
        comment: "  rude  ",
      })
    );
    expect(db.table("moderation_reports")[0]).toMatchObject({ entity_type: "wall_post", details: "rude" });
  });

  it("returns an error instead of reported:true when the insert fails", async () => {
    const db = install();
    const realFrom = db.client.from;
    const spy = vi.spyOn(db.client, "from").mockImplementation((table: string) => {
      if (table !== "moderation_reports") return realFrom(table);
      return { insert: async () => ({ data: null, error: { message: "violates check constraint" } }) } as never;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await postReport(
      req("POST", "/api/v1/reports", "tok-player", { category: "spam", target_type: "find", target_id: UUID })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).reported).toBeUndefined();
    spy.mockRestore();
    errorLog.mockRestore();
  });

  it("rejects a non-UUID target with 400 rather than a database error", async () => {
    install();
    const res = await postReport(
      req("POST", "/api/v1/reports", "tok-player", { category: "spam", target_type: "find", target_id: "not-a-uuid" })
    );
    expect(res.status).toBe(400);
  });
});

describe("moderation review", () => {
  const report = { id: "r1", reporter_id: "player1", entity_type: "content", entity_id: UUID, reason: "spam", status: "pending" };

  it("rejects statuses outside the CHECK constraint with 400, leaving the report pending", async () => {
    const db = install({ moderation_reports: [report] });
    const res = await reviewReport(
      req("POST", "/api/v1/moderation/r1/review", "tok-admin", { status: "approved" }),
      idParams("r1")
    );
    expect(res.status).toBe(400);
    expect(db.table("moderation_reports")[0].status).toBe("pending");
  });

  it("applies a valid status and records the reviewer", async () => {
    const db = install({ moderation_reports: [report] });
    const res = await reviewReport(
      req("POST", "/api/v1/moderation/r1/review", "tok-admin", { status: "dismissed" }),
      idParams("r1")
    );
    expect(res.status).toBe(200);
    expect(db.table("moderation_reports")[0]).toMatchObject({ status: "dismissed", reviewed_by: "admin1" });
  });

  it("returns 404 for an unknown report", async () => {
    install();
    const res = await reviewReport(
      req("POST", "/api/v1/moderation/nope/review", "tok-admin", { status: "actioned" }),
      idParams("nope")
    );
    expect(res.status).toBe(404);
  });

  it("answers a researcher with 403 so the page can show a permission message", async () => {
    install();
    const res = await listReports(req("GET", "/api/v1/moderation?status=pending", "tok-researcher"));
    expect(res.status).toBe(403);
  });
});

describe("PUT /api/v1/admin/users/[id]", () => {
  it("lets an admin change another user's role and status", async () => {
    const db = install();
    const res = await putUser(
      req("PUT", "/api/v1/admin/users/player1", "tok-admin", { role: "teacher", status: "inactive" }),
      idParams("player1")
    );
    expect(res.status).toBe(200);
    expect(db.where("users", (u) => u.id === "player1")[0]).toMatchObject({ role: "teacher", status: "inactive" });
  });

  it("refuses an admin demoting or deactivating themselves", async () => {
    const db = install();
    const demote = await putUser(
      req("PUT", "/api/v1/admin/users/admin1", "tok-admin", { role: "researcher" }),
      idParams("admin1")
    );
    const deactivate = await putUser(
      req("PUT", "/api/v1/admin/users/admin1", "tok-admin", { status: "inactive" }),
      idParams("admin1")
    );
    expect(demote.status).toBe(400);
    expect(deactivate.status).toBe(400);
    expect(db.where("users", (u) => u.id === "admin1")[0]).toMatchObject({ role: "admin", status: "active" });
  });

  it("is admin-only and rejects an empty update", async () => {
    install();
    const forbidden = await putUser(
      req("PUT", "/api/v1/admin/users/player1", "tok-researcher", { role: "teacher" }),
      idParams("player1")
    );
    const empty = await putUser(req("PUT", "/api/v1/admin/users/player1", "tok-admin", {}), idParams("player1"));
    expect(forbidden.status).toBe(403);
    expect(empty.status).toBe(400);
  });
});

describe("GET /api/v1/research/participants", () => {
  it("returns each participant with their assignments for the study's dimensions", async () => {
    install(
      {
        study_enrollments: [
          { id: "e1", study_id: "s1", user_id: "player1", withdrawn_at: null },
          { id: "e2", study_id: "s1", user_id: "res1", withdrawn_at: daysAgo(1) },
        ],
        treatment_study_dimensions: [{ study_id: "s1", dimension_id: "d1" }],
        treatment_dimensions: [
          { id: "d1", name: "privacy_control_complexity" },
          { id: "d2", name: "other_study_dimension" },
        ],
        dimension_assignments: [
          { id: "a1", user_id: "player1", dimension_id: "d1", level: "complex" },
          { id: "a2", user_id: "player1", dimension_id: "d2", level: "x" },
        ],
      },
      { embeds: { study_enrollments: { users: { table: "users", localKey: "user_id" } } } }
    );
    const res = await getParticipants(req("GET", "/api/v1/research/participants?study_id=s1", "tok-researcher"));
    expect(res.status).toBe(200);
    const { participants } = await res.json();
    expect(participants).toHaveLength(1);
    expect(participants[0].user_id).toBe("player1");
    expect(participants[0].dimension_assignments).toHaveLength(1);
    expect(participants[0].dimension_assignments[0]).toMatchObject({
      level: "complex",
      treatment_dimensions: { name: "privacy_control_complexity" },
    });
  });
});

describe("getStudyHealth", () => {
  it("counts past the 1000-row PostgREST cap and reports enrollment from the rows", async () => {
    const now = new Date().toISOString();
    const events: Row[] = [];
    for (let i = 0; i < 1500; i++) {
      events.push({ id: `pe${String(i).padStart(5, "0")}`, user_id: i < 1400 ? "u1" : "u2", created_at: i < 1200 ? daysAgo(5) : now });
    }
    const snapshots: Row[] = [];
    for (let i = 0; i < 1100; i++) {
      snapshots.push({ id: `sn${String(i).padStart(5, "0")}`, user_id: i < 1050 ? "u1" : "u2" });
    }
    const ledger: Row[] = [];
    for (let i = 0; i < 1200; i++) {
      ledger.push({ id: `pl${String(i).padStart(5, "0")}`, user_id: "u1", source_type: "referral", amount: 1 });
    }
    install({
      // current_sample_size is stale on purpose: it is never decremented on withdrawal.
      treatment_studies: [{ id: "s1", study_code: "pilot", name: "Pilot", status: "active", current_sample_size: 3, target_sample_size: 240 }],
      study_enrollments: [
        { id: "e1", study_id: "s1", user_id: "u1", withdrawn_at: null },
        { id: "e2", study_id: "s1", user_id: "u2", withdrawn_at: null },
        { id: "e3", study_id: "s1", user_id: "u3", withdrawn_at: daysAgo(2) },
      ],
      privacy_events: events,
      privacy_index_snapshots: snapshots,
      points_ledger: ledger,
      minion_links: [{ id: "m1", recruiter_id: "u1", minion_id: "u2" }],
    });

    const health = await getStudyHealth("s1");
    expect(health.enrollment).toEqual({ active: 2, withdrawn: 1 });
    expect(health.logging).toEqual({
      participants: 2,
      with_privacy_events: 2, // u2's events all sit past row 1000
      with_snapshots: 2,
      privacy_events_total: 1500,
      events_last_24h: 300,
    });
    expect(health.referral).toEqual({ minion_links: 1, referral_points_total: 1200 });
  });
});

describe("security routes", () => {
  it("re-blocking an already-blocked IP re-activates it instead of failing silently", async () => {
    const db = install(
      { blocked_ips: [{ id: UUID, ip_hash: "abc", is_active: false, reason: "old" }] },
      { unique: { blocked_ips: [["ip_hash"]] } }
    );
    const res = await blockIp(req("POST", "/api/v1/admin/block-ip", "tok-admin", { ip_hash: "abc", expires_in_days: 30 }));
    expect(res.status).toBe(200);
    expect(db.table("blocked_ips")).toHaveLength(1);
    expect(db.table("blocked_ips")[0]).toMatchObject({ ip_hash: "abc", is_active: true, blocked_by: "admin1" });

    // audit_log.action is CHECKed to create|update|delete and entity_id is a UUID.
    const [audit] = db.table("audit_log");
    expect(audit).toMatchObject({ action: "create", entity_type: "blocked_ip", entity_id: UUID });
    expect((audit.new_values as Row).op).toBe("block_ip");
  });

  it("writes a label audit row that satisfies the audit_log constraints", async () => {
    const db = install();
    const res = await labelThreat(
      req("POST", "/api/v1/admin/label-threat", "tok-admin", { session_id: "sess-1", ip_hash: null, attack_type: "scanner" })
    );
    expect(res.status).toBe(200);
    const [label] = db.table("threat_classifications");
    const [audit] = db.table("audit_log");
    expect(audit).toMatchObject({ action: "create", entity_type: "threat_classification", entity_id: label.id });
    expect(audit.new_values).toMatchObject({ op: "label_threat", session_id: "sess-1", attack_type: "scanner" });
  });

  it("answers an empty export with a bodiless 204 instead of throwing", async () => {
    install();
    const res = await threatExport(req("GET", "/api/v1/admin/threat-export?table=blocked_ips", "tok-admin"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("groups events by session and reports IP/user agent only where they were recorded", async () => {
    install({
      behavioral_events: [
        { id: "b1", user_id: "player1", session_id: "sess-1", event_type: "play_start", payload: {}, created_at: daysAgo(1) },
        { id: "b2", user_id: "player1", session_id: "sess-1", event_type: "hint_request", payload: {}, created_at: daysAgo(1) },
        { id: "b3", user_id: null, session_id: null, event_type: "bot_suspicious", payload: { ip_hash: "h1", user_agent: "curl/8" }, created_at: daysAgo(1) },
        { id: "b4", user_id: "player1", session_id: null, event_type: "login_attempt", payload: {}, created_at: daysAgo(1) },
      ],
    });
    const res = await threatSessions(req("GET", "/api/v1/admin/threat-sessions", "tok-admin"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events_without_session).toBe(1);
    const byId = Object.fromEntries(body.sessions.map((s: { session_id: string }) => [s.session_id, s]));
    expect(byId["sess-1"]).toMatchObject({ event_count: 2, ip_hash: null, user_agent: null });
    expect(byId["ip:h1"]).toMatchObject({ event_count: 1, ip_hash: "h1", user_agent: "curl/8" });
  });
});

describe("GET /api/cron/reengagement", () => {
  const SECRET = "test-cron-secret";
  const prev = process.env.CRON_SECRET;
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    process.env.CRON_SECRET = prev;
  });

  it("judges activity by find completions reached through play_sessions, not session start alone", async () => {
    const db = install({
      study_enrollments: [
        { id: "e1", study_id: "s1", user_id: "active", enrolled_at: daysAgo(30), withdrawn_at: null },
        { id: "e2", study_id: "s1", user_id: "idle", enrolled_at: daysAgo(30), withdrawn_at: null },
      ],
      play_sessions: [
        { id: "ps1", user_id: "active", started_at: daysAgo(10) },
        { id: "ps2", user_id: "idle", started_at: daysAgo(10) },
      ],
      // find_completions has no user_id column — only play_session_id.
      find_completions: [
        { id: "fc0", play_session_id: "ps1", completed_at: null },
        { id: "fc1", play_session_id: "ps1", completed_at: daysAgo(1) },
        { id: "fc2", play_session_id: "ps2", completed_at: daysAgo(9) },
      ],
    });

    const res = await reengagementCron(
      new NextRequest("http://localhost/api/cron/reengagement", { headers: { authorization: `Bearer ${SECRET}` } })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ participants_considered: 2, nudges_sent: 1 });
    expect(db.table("notifications").map((n) => n.user_id)).toEqual(["idle"]);
  });
});
