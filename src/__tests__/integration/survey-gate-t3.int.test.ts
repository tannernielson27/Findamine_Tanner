import { describe, it, expect, vi, beforeEach } from "vitest";
import { installDouble, daysAgo } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { createDueDeliveriesForUser, createEventDeliveriesForUser } from "@/lib/services/survey-delivery";
import { pickSurveyGate } from "@/app/(app)/settings/privacy/privacy-page-data";

const T1 = "survey-t1";
const T2 = "survey-t2";
const T3 = "survey-t3";
const GATE = ["T1", "T3"];

describe("privacy-page survey gate covers the day-42 T3 check-in", () => {
  beforeEach(() => {
    installDouble({
      surveys: [
        { id: T1, title: "App Check-in (Start)", status: "active" },
        { id: T2, title: "App Check-in (Midpoint)", status: "active" },
        { id: T3, title: "App Check-in (End)", status: "active" },
      ],
      survey_schedules: [
        { survey_id: T1, trigger_type: "event", trigger_config: { timepoint: "T1", event: "privacy_view", expires_days: 7 }, active: true },
        { survey_id: T2, trigger_type: "time", trigger_config: { timepoint: "T2", offset_days: 21, expires_days: 10 }, active: true },
        { survey_id: T3, trigger_type: "time", trigger_config: { timepoint: "T3", offset_days: 42, expires_days: 10 }, active: true },
      ],
      study_enrollments: [{ study_id: "s", user_id: "u1", enrolled_at: daysAgo(43), withdrawn_at: null }],
      survey_deliveries: [
        // T1 answered at the start of the study.
        { id: "d-t1", survey_id: T1, user_id: "u1", status: "submitted", expires_at: null },
      ],
    });
  });

  it("reports the time-delivered T3 as pending on a privacy view and gates on it, but never on T2", async () => {
    expect(await createDueDeliveriesForUser("u1", daysAgo(43))).toBe(2); // T2 and T3 now due

    const { pending } = await createEventDeliveriesForUser("u1", "privacy_view");
    expect(new Set(pending.map((p) => p.timepoint))).toEqual(new Set(["T2", "T3"]));

    const gate = pickSurveyGate(pending, GATE);
    expect(gate?.timepoint).toBe("T3");
    expect(pickSurveyGate(pending.filter((p) => p.timepoint === "T2"), GATE)).toBeNull();
  });

  it("prefers T1 when both gating check-ins are pending", () => {
    const gate = pickSurveyGate(
      [
        { delivery_id: "d3", survey_id: T3, timepoint: "T3" },
        { delivery_id: "d1", survey_id: T1, timepoint: "T1" },
      ],
      GATE
    );
    expect(gate).toEqual({ deliveryId: "d1", timepoint: "T1" });
  });
});
