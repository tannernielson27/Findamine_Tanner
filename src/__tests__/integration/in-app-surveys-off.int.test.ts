import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, daysAgo } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import {
  createDueDeliveriesForUser,
  createEventDeliveriesForUser,
  sendSurveyReminders,
} from "@/lib/services/survey-delivery";

// Pilot default (study-config.ts): Qualtrics is the source of record, so the
// app never delivers, gates on, or reminds about its own surveys, even when an
// active survey and schedule exist.
describe("in-app surveys are off for the pilot", () => {
  beforeEach(() => {
    installDouble({
      surveys: [{ id: "t1", title: "Baseline", status: "active" }],
      survey_schedules: [
        { survey_id: "t1", trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 }, active: true },
        { survey_id: "t1", trigger_type: "time", trigger_config: { timepoint: "T1", offset_days: 3, expires_days: 7 }, active: true },
      ],
      survey_deliveries: [{ id: "d1", survey_id: "t1", user_id: "u2", status: "pending", created_at: daysAgo(1) }],
      study_enrollments: [
        { id: "e1", study_id: "s", user_id: "u1", enrolled_at: daysAgo(10), withdrawn_at: null },
        { id: "e2", study_id: "s", user_id: "u2", enrolled_at: daysAgo(10), withdrawn_at: null },
      ],
    });
  });

  it("creates no deliveries on either path and sends no reminders", async () => {
    expect(await createDueDeliveriesForUser("u1", daysAgo(10))).toBe(0);
    expect(await createEventDeliveriesForUser("u1", "privacy_view")).toEqual({ created: 0, pending: [] });
    expect(await sendSurveyReminders()).toBe(0);
  });
});
