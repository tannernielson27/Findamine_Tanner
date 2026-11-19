import { describe, expect, it, vi } from "vitest";
import { installDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return { createSupabaseServiceClient: async () => m.current().client };
});

import {
  generatePlaySessionsExport,
  PLAY_SESSION_HEADERS,
  playSessionRows,
  sessionDeliveryColumns,
  sessionNavigationHelpColumn,
} from "@/lib/services/play-sessions-export";
import { serialize } from "@/lib/services/research-export";

const enrollment = { user_id: "u1", participant_code: "FM-ABC234", enrolled_at: "2026-11-01T00:00:00.000Z" };
const session = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  user_id: "u1",
  hunt_id: "h1",
  status: "completed",
  started_at: "2026-11-02T00:00:00.000Z",
  completed_at: "2026-11-02T01:00:00.000Z",
  metadata: { clue_delivery: "assigned_order", clue_order_index: 2 },
  ...over,
});

describe("sessionDeliveryColumns", () => {
  it("reads the recorded mode and the 0-based order group", () => {
    expect(sessionDeliveryColumns({ clue_delivery: "assigned_order", clue_order_index: 0 })).toEqual(["assigned_order", "0"]);
    expect(sessionDeliveryColumns({ clue_delivery: "random_order" })).toEqual(["random_order", ""]);
  });

  it("exports only known values (allowlisted), never arbitrary metadata", () => {
    expect(sessionDeliveryColumns({ clue_delivery: "=HYPERLINK(\"x\")", clue_order_index: "1" })).toEqual(["", ""]);
    expect(sessionDeliveryColumns({ clue_delivery: "fixed_order", clue_order_index: -1 })).toEqual(["fixed_order", ""]);
    expect(sessionDeliveryColumns({ clue_delivery: "fixed_order", clue_order_index: 1.5 })).toEqual(["fixed_order", ""]);
    expect(sessionDeliveryColumns(null)).toEqual(["", ""]);
  });
});

describe("sessionNavigationHelpColumn", () => {
  it("reads the difficulty the session was played at", () => {
    expect(sessionNavigationHelpColumn({ clue_delivery: "fixed_order", navigation_help: "hard" })).toBe("hard");
    expect(sessionNavigationHelpColumn({ navigation_help: "easy" })).toBe("easy");
  });

  it("is blank for sessions from before the setting, and for anything unknown", () => {
    expect(sessionNavigationHelpColumn({ clue_delivery: "fixed_order" })).toBe("");
    expect(sessionNavigationHelpColumn({ navigation_help: "=HYPERLINK(\"x\")" })).toBe("");
    expect(sessionNavigationHelpColumn({ navigation_help: 3 })).toBe("");
    expect(sessionNavigationHelpColumn(null)).toBe("");
  });
});

describe("playSessionRows", () => {
  it("keys each session by Study ID with the clue delivery columns", () => {
    const medium = { clue_delivery: "fixed_order", navigation_help: "medium" };
    const rows = playSessionRows(
      [enrollment],
      [session(), session({ id: "s3", hunt_id: "h2", metadata: medium })],
      new Set(["h1"]),
      new Set(["h2"])
    );
    expect(PLAY_SESSION_HEADERS).toEqual([
      "participant_id",
      "session_id",
      "hunt_id",
      "status",
      "started_at",
      "completed_at",
      "days_since_enrollment",
      "clue_delivery",
      "clue_order_index",
      "study_hunt",
      "navigation_help",
      "scoring_version",
    ]);
    expect(rows).toEqual([
      ["FM-ABC234", "s1", "h1", "completed", "2026-11-02T00:00:00.000Z", "2026-11-02T01:00:00.000Z", "1.0000", "assigned_order", "2", "1", "", "1"],
      ["FM-ABC234", "s3", "h2", "completed", "2026-11-02T00:00:00.000Z", "2026-11-02T01:00:00.000Z", "1.0000", "fixed_order", "", "0", "medium", "2"],
    ]);
  });

  it("puts every hunt on scoring version 1 unless it is named as version 2", () => {
    const rows = playSessionRows([enrollment], [session()], new Set());
    expect(rows[0][PLAY_SESSION_HEADERS.indexOf("scoring_version")]).toBe("1");
  });

  it("leaves out sessions from before enrollment and from people not enrolled", () => {
    const rows = playSessionRows([enrollment], [
      session({ id: "early", started_at: "2026-10-30T00:00:00.000Z" }),
      session({ id: "other", user_id: "stranger" }),
    ], new Set());
    expect(rows).toEqual([]);
  });

  it("serializes through the shared formula guard", () => {
    const rows = playSessionRows([enrollment], [session({ status: "=cmd" })], new Set());
    expect(serialize(PLAY_SESSION_HEADERS, rows, "csv")).toContain("'=cmd");
  });
});

describe("generatePlaySessionsExport", () => {
  it("exports enrolled, non-withdrawn participants' sessions by Study ID", async () => {
    installDouble({
      study_enrollments: [
        { study_id: "st1", user_id: "u1", participant_code: "FM-ABC234", enrolled_at: "2026-11-01T00:00:00.000Z", withdrawn_at: null },
        { study_id: "st1", user_id: "u2", participant_code: "FM-WDRAWN", enrolled_at: "2026-11-01T00:00:00.000Z", withdrawn_at: "2026-11-03T00:00:00.000Z" },
      ],
      play_sessions: [session(), session({ id: "s2", user_id: "u2" })],
      hunts: [{ id: "h1", metadata: { study_hunt: true, scoring_version: 2, scoring_solve_window_min: 777, clue_orders: [["x"]] } }],
    });
    const csv = await generatePlaySessionsExport({ studyId: "st1", format: "csv" });
    const lines = csv.split("\n");
    expect(lines[0]).toBe(PLAY_SESSION_HEADERS.join(","));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("FM-ABC234,s1,h1");
    expect(lines[1].endsWith(",assigned_order,2,1,,2")).toBe(true);
    // Only the study flag and the scoring version are read from hunt metadata.
    expect(csv).not.toContain("777");
    expect(csv).not.toContain("scoring_solve_window_min");
    expect(csv).not.toContain("clue_orders");
    expect(csv).not.toContain("u1");
    expect(csv).not.toContain("FM-WDRAWN");
  });

  it("returns nothing when the study has no participants", async () => {
    installDouble({ study_enrollments: [], play_sessions: [], hunts: [] });
    expect(await generatePlaySessionsExport({ studyId: "st1", format: "csv" })).toBe("");
  });
});
