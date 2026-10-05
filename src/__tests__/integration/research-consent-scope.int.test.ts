import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, daysAgo } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { PUT as putProfile } from "@/app/api/v1/auth/profile/route";
import { POST as postPrivacyEvent } from "@/app/api/v1/research/privacy-events/route";
import { POST as postWithdraw } from "@/app/api/v1/research/withdraw/route";
import { POST as postRespond } from "@/app/api/v1/surveys/[id]/respond/route";
import { GET as getSurveys } from "@/app/api/v1/surveys/route";
import { expireStaleDeliveries, sendSurveyReminders } from "@/lib/services/survey-delivery";

/**
 * Consent and withdrawal promises, enforced in code: study rows are written
 * only for enrolled, non-withdrawn participants; withdrawal closes surveys and
 * is a no-op for anyone who was never enrolled.
 */

const ALL_EVERYONE = {
  display_name: "everyone", avatar: "everyone", real_name: "everyone", personality_scores: "everyone",
  badges: "everyone", total_score: "everyone", hunt_history: "everyone", friends_list: "everyone",
};
const TIGHTER = { ...ALL_EVERYONE, total_score: "nobody" };

// participant · decliner (never enrolled) · withdrawn
const USERS = ["part", "decl", "gone"] as const;
type Who = (typeof USERS)[number];
const token = (who: Who) => `token-${who}`;

function seed() {
  return installDouble(
    {
      users: USERS.map((id) => ({
        id, auth_id: `auth-${id}`, role: "adult", deleted_at: null, display_name: id,
        profile_visibility: { ...ALL_EVERYONE },
        profile_visibility_overrides: {},
        metadata:
          id === "decl"
            ? {}
            : {
                privacy_treatment: "moderate", privacy_default: "public",
                ...(id === "gone" ? { research_withdrawn_at: daysAgo(2) } : {}),
              },
      })),
      study_enrollments: [
        { id: "e-part", study_id: "s", user_id: "part", enrolled_at: daysAgo(10), withdrawn_at: null },
        { id: "e-gone", study_id: "s", user_id: "gone", enrolled_at: daysAgo(10), withdrawn_at: daysAgo(2) },
      ],
      minion_links: [
        { id: "l1", recruiter_id: "part", minion_id: "m1" },
        { id: "l2", recruiter_id: "boss", minion_id: "part" },
        { id: "l3", recruiter_id: "decl", minion_id: "m2" },
        { id: "l4", recruiter_id: "gone", minion_id: "m3" }, // formed after withdrawing
      ],
      surveys: [{ id: "sv", title: "Check-in", status: "active" }],
      survey_questions: [],
      survey_deliveries: [
        { id: "d-pending", survey_id: "sv", user_id: "part", status: "pending", expires_at: daysAgo(-5) },
        { id: "d-opened", survey_id: "sv", user_id: "part", status: "opened", expires_at: daysAgo(-5) },
        { id: "d-done", survey_id: "sv", user_id: "part", status: "submitted", expires_at: daysAgo(-5) },
        { id: "d-gone", survey_id: "sv", user_id: "gone", status: "pending", expires_at: daysAgo(-5) },
        { id: "d-decl", survey_id: "sv", user_id: "decl", status: "pending", expires_at: daysAgo(-5) },
      ],
      friend_connections: [],
      privacy_events: [],
      privacy_index_snapshots: [],
      behavioral_events: [],
      notifications: [],
      notification_preferences: [],
      survey_responses: [],
    },
    { authTokens: Object.fromEntries(USERS.map((u) => [token(u), { id: `auth-${u}` }])) }
  );
}

function request(who: Who, url: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { authorization: `Bearer ${token(who)}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const saveProfile = (who: Who) =>
  putProfile(request(who, "/api/v1/auth/profile", "PUT", { profile_visibility: TIGHTER }));
const logView = (who: Who) =>
  postPrivacyEvent(request(who, "/api/v1/research/privacy-events", "POST", { event_type: "privacy_view" }));
const withdraw = (who: Who) => postWithdraw(request(who, "/api/v1/research/withdraw", "POST"));
const respond = (who: Who, deliveryId: string) =>
  postRespond(request(who, `/api/v1/surveys/${deliveryId}/respond`, "POST", { answers: {} }), {
    params: Promise.resolve({ id: deliveryId }),
  });

describe("study data is collected from participants only", () => {
  it("a profile save records a privacy_change + snapshot for a participant", async () => {
    const db = seed();
    expect((await saveProfile("part")).status).toBe(200);
    expect(db.where("privacy_events", (e) => e.user_id === "part")).toHaveLength(1);
    expect(db.where("privacy_index_snapshots", (s) => s.user_id === "part")).toHaveLength(1);
  });

  it.each(["decl", "gone"] as const)("a profile save by %s still succeeds but records nothing", async (who) => {
    const db = seed();
    expect((await saveProfile(who)).status).toBe(200);
    expect(db.table("users").find((u) => u.id === who)!.profile_visibility).toEqual(TIGHTER);
    expect(db.table("privacy_events")).toHaveLength(0);
    expect(db.table("privacy_index_snapshots")).toHaveLength(0);
  });

  it("client privacy events are stored for a participant and dropped for everyone else", async () => {
    const db = seed();
    expect((await logView("part")).status).toBe(201);
    for (const who of ["decl", "gone"] as const) {
      const res = await logView(who);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ event: null, recorded: false });
    }
    expect(db.table("privacy_events").map((e) => e.user_id)).toEqual(["part"]);
  });

  it("marks a save that carried edits restored from a survey-gate draft", async () => {
    const db = seed();
    await putProfile(
      request("part", "/api/v1/auth/profile", "PUT", {
        profile_visibility: TIGHTER,
        privacy_meta: { draft_restored: true },
      })
    );
    expect((db.table("privacy_events")[0].metadata as Record<string, unknown>).draft_restored).toBe(true);
  });
});

describe("POST /api/v1/research/withdraw", () => {
  it("withdraws a participant: enrollment, crew links and unanswered surveys", async () => {
    const db = seed();
    const res = await withdraw("part");
    expect(await res.json()).toEqual({ ok: true, status: "withdrawn", withdrawn: 1 });

    expect(db.table("study_enrollments").find((e) => e.id === "e-part")!.withdrawn_at).toBeTruthy();
    expect(typeof (db.table("users").find((u) => u.id === "part")!.metadata as Record<string, unknown>)
      .research_withdrawn_at).toBe("string");
    // Both directions gone; other people's links untouched.
    expect(db.table("minion_links").map((l) => l.id).sort()).toEqual(["l3", "l4"]);
    // Unanswered deliveries closed; the submitted one keeps its status.
    const status = (id: string) => db.table("survey_deliveries").find((d) => d.id === id)!.status;
    expect(status("d-pending")).toBe("abandoned");
    expect(status("d-opened")).toBe("abandoned");
    expect(status("d-done")).toBe("submitted");
    expect(status("d-decl")).toBe("pending");
    expect(db.where("behavioral_events", (e) => e.event_type === "study_withdrawn")).toHaveLength(1);
  });

  it("is a no-op for someone who was never enrolled, and says so", async () => {
    const db = seed();
    const res = await withdraw("decl");
    expect(await res.json()).toEqual({ ok: true, status: "not_enrolled", withdrawn: 0 });
    expect(db.table("minion_links")).toHaveLength(4); // crew intact
    expect(db.table("users").find((u) => u.id === "decl")!.metadata).toEqual({});
    expect(db.table("behavioral_events")).toHaveLength(0);
    expect(db.table("survey_deliveries").find((d) => d.id === "d-decl")!.status).toBe("pending");
  });

  it("does not tear down crew links again for an already-withdrawn participant", async () => {
    const db = seed();
    const res = await withdraw("gone");
    expect(await res.json()).toEqual({ ok: true, status: "already_withdrawn", withdrawn: 0 });
    expect(db.table("minion_links")).toHaveLength(4);
    expect(db.table("behavioral_events")).toHaveLength(0);
  });
});

describe("survey deliveries", () => {
  it("reminders skip withdrawn participants", async () => {
    const db = seed();
    expect(await sendSurveyReminders()).toBe(2); // part + decl (not study-withdrawn), never gone
    expect(db.table("notifications").map((n) => n.user_id).sort()).toEqual(["decl", "part"]);
  });

  it("a withdrawal's closed deliveries stop the reminders", async () => {
    const db = seed();
    await withdraw("part");
    await sendSurveyReminders();
    expect(db.where("notifications", (n) => n.user_id === "part")).toHaveLength(0);
  });

  it("expires opened deliveries past their deadline, not just pending ones", async () => {
    const db = seed();
    db.table("survey_deliveries").find((d) => d.id === "d-opened")!.expires_at = daysAgo(1);
    db.table("survey_deliveries").find((d) => d.id === "d-done")!.expires_at = daysAgo(1);
    expect(await expireStaleDeliveries()).toBe(1);
    const status = (id: string) => db.table("survey_deliveries").find((d) => d.id === id)!.status;
    expect(status("d-opened")).toBe("expired");
    expect(status("d-done")).toBe("submitted");
    expect(status("d-pending")).toBe("pending");
  });

  it("rejects a response to an expired, closed or past-deadline delivery", async () => {
    const db = seed();
    const row = (id: string) => db.table("survey_deliveries").find((d) => d.id === id)!;
    row("d-pending").status = "expired";
    row("d-opened").expires_at = daysAgo(1); // deadline passed, cron not yet run
    expect((await respond("part", "d-pending")).status).toBe(410);
    expect((await respond("part", "d-opened")).status).toBe(410);
    expect((await respond("part", "d-done")).status).toBe(409);
    expect(db.table("survey_responses")).toHaveLength(0);
    expect(row("d-opened").status).toBe("opened");
  });

  it("accepts a response to a live delivery", async () => {
    const db = seed();
    expect((await respond("part", "d-opened")).status).toBe(201);
    expect(db.table("survey_deliveries").find((d) => d.id === "d-opened")!.status).toBe("submitted");
  });

  it("the to-do list leaves out deliveries past their deadline", async () => {
    const db = seed();
    db.table("survey_deliveries").find((d) => d.id === "d-opened")!.expires_at = daysAgo(1);
    const res = await getSurveys(request("part", "/api/v1/surveys?pending=true", "GET"));
    const body = (await res.json()) as { deliveries: { id: string }[] };
    expect(body.deliveries.map((d) => d.id)).toEqual(["d-pending"]);
  });
});
