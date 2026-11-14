import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, daysAgo, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { enrollParticipant } from "@/lib/services/enrollment";
import { getParticipantSurveys, notifyOpenSurveyWaves } from "@/lib/services/qualtrics-surveys";

const STUDY = "study-1";
const D_DEFAULT = "dim-default";

function seed(users: Array<{ id: string; email?: string; metadata?: Record<string, unknown> }>): SupabaseDouble {
  const rows = users.map((u) => ({
    id: u.id,
    role: "adult",
    date_of_birth: "1990-01-01",
    email: u.email ?? `${u.id}@byu.edu`,
    school_id: null,
    metadata: u.metadata ?? {},
    profile_visibility: {},
    profile_visibility_overrides: {},
  }));
  return installDouble({
    treatment_studies: [{ id: STUDY, status: "active", auto_enroll: true, current_sample_size: 0 }],
    treatment_dimensions: [{ id: D_DEFAULT, name: "privacy_default", levels: ["public", "private"], is_active: true }],
    treatment_study_dimensions: [{ study_id: STUDY, dimension_id: D_DEFAULT, sort_order: 0, active_levels: null }],
    users: rows,
    user_profiles: rows.map((u) => ({ user_id: u.id, effective_band: "adult" })),
    consent_records: rows.map((u) => ({ user_id: u.id, consent_type: "research", granted: true, revoked_at: null })),
    survey_schedules: [],
  });
}

describe("pilot enrollment", () => {
  it("never enrolls demo or .invalid accounts, even with consent", async () => {
    const db = seed([
      { id: "demo", metadata: { demo_account: true } },
      { id: "qa", email: "lt-001@loadtest.invalid" },
      { id: "real" },
    ]);
    expect((await enrollParticipant("demo")).enrolled).toBe(false);
    expect((await enrollParticipant("qa")).enrolled).toBe(false);
    expect((await enrollParticipant("real")).enrolled).toBe(true);
    expect(db.table("study_enrollments").map((e) => e.user_id)).toEqual(["real"]);
  });

  it("splits MID and PEOU within one of 50/50 in every cell", async () => {
    const ids = Array.from({ length: 24 }, (_, i) => `u${i + 1}`);
    const db = seed(ids.map((id) => ({ id })));
    for (const id of ids) expect((await enrollParticipant(id)).enrolled).toBe(true);

    const byCell = new Map<string, Array<Record<string, unknown>>>();
    for (const e of db.table("study_enrollments")) {
      const key = String(e.cell_key);
      byCell.set(key, [...(byCell.get(key) ?? []), e]);
    }
    expect([...byCell.keys()].sort()).toEqual(["privacy_default=private", "privacy_default=public"]);
    for (const rows of byCell.values()) {
      for (const col of ["mid_survey", "peou_block"]) {
        const yes = rows.filter((r) => r[col] === true).length;
        expect(Math.abs(yes - (rows.length - yes))).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("Qualtrics surveys against the Supabase double", () => {
  let db: SupabaseDouble;
  let firstViewAt: string;
  beforeEach(() => {
    firstViewAt = daysAgo(14);
    db = installDouble({
      treatment_studies: [{ id: STUDY, status: "active" }],
      study_enrollments: [
        { id: "e1", study_id: STUDY, user_id: "u1", participant_code: "FM-AAAAAA", enrolled_at: daysAgo(15), withdrawn_at: null, mid_survey: true, peou_block: true },
        { id: "e2", study_id: STUDY, user_id: "u2", participant_code: "FM-BBBBBB", enrolled_at: daysAgo(15), withdrawn_at: daysAgo(2), mid_survey: true, peou_block: false },
      ],
      privacy_events: [
        { id: "p0", user_id: "u1", event_type: "privacy_view", created_at: daysAgo(20) }, // before enrollment
        { id: "p1", user_id: "u1", event_type: "privacy_view", created_at: firstViewAt },
      ],
      qualtrics_launches: [
        { id: "q1", study_id: STUDY, user_id: "u1", wave: "T0", action: "marked_done", created_at: daysAgo(15) },
      ],
      notifications: [],
    });
  });

  it("gives a participant their Study ID and which surveys are open", async () => {
    const s = await getParticipantSurveys("u1");
    expect(s?.participantCode).toBe("FM-AAAAAA");
    const by = Object.fromEntries((s?.waves ?? []).map((w) => [w.wave, w]));
    expect(by.T0.status).toBe("done");
    expect(by.T1.status).toBe("open");
    expect(by.T1.opensAt).toBe(firstViewAt); // first view after enrollment, not the earlier one
    expect(by.MID.status).toBe("open");
    expect(by.T2.status).toBe("not_yet");
  });

  it("returns nothing for a withdrawn participant or a non-participant", async () => {
    expect(await getParticipantSurveys("u2")).toBeNull();
    expect(await getParticipantSurveys("nobody")).toBeNull();
  });

  it("posts one bell item per open wave, once, and never to the withdrawn", async () => {
    expect(await notifyOpenSurveyWaves()).toBe(2); // T1 + MID for u1
    expect(await notifyOpenSurveyWaves()).toBe(0); // deduped
    const notes = db.table("notifications");
    expect(notes.every((n) => n.user_id === "u1" && n.type === "study_survey")).toBe(true);
    expect(notes.map((n) => n.title).sort()).toEqual(["First check-in is ready", "Week 2 check-in is ready"]);
  });
});
