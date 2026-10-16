import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { installDouble, type Row, type SupabaseDouble } from "@/__tests__/support/supabase-double";

vi.mock("@/lib/supabase/server", async () => {
  const m = await import("@/__tests__/support/supabase-double");
  return {
    createSupabaseServiceClient: async () => m.current().client,
    createSupabaseServerClient: async () => m.current().client,
  };
});

import { POST as postConsent } from "@/app/api/v1/consent/route";
import { enrollParticipant } from "@/lib/services/enrollment";
import { applyNonParticipantDefaults } from "@/lib/services/non-participant-defaults";
import { awardReferralPoints, redeemReferral, REFERRAL_FRACTION } from "@/lib/services/referral";
import {
  NON_PARTICIPANT_DEFAULTS_KEY,
  nonParticipantDefaults,
} from "@/lib/utils/non-participant-defaults";
import { AGE_ATTESTATION_KEY } from "@/lib/utils/research-eligibility";

/**
 * Adults-only study, enforced in code: minors can neither consent nor be
 * randomized; non-participants start private-leaning and are never subject
 * to the referral visibility gate.
 */

const STUDY = "study-1";
const D_DEFAULT = "dim-default";
const HIDDEN = { display_name: "nobody", total_score: "nobody" };

type Who = "adult" | "teen" | "child" | "kid18" | "parent" | "staff";
const PEOPLE: Record<Who, Row> = {
  adult: { role: "adult", date_of_birth: "1999-01-01" },
  teen: { role: "teen", date_of_birth: "2010-03-01" },
  child: { role: "child", date_of_birth: "2016-03-01" },
  // Self-registered as "adult" in the past, but the DOB says 16.
  kid18: { role: "adult", date_of_birth: "2010-06-01" },
  parent: { role: "parent", date_of_birth: null },
  staff: { role: "researcher", date_of_birth: null },
};

function seed(extra: Record<string, Row[]> = {}): SupabaseDouble {
  const users: Row[] = (Object.keys(PEOPLE) as Who[]).map((id) => ({
    id,
    auth_id: `auth-${id}`,
    display_name: id,
    deleted_at: null,
    school_id: null,
    metadata: {},
    profile_visibility: {},
    profile_visibility_overrides: {},
    ...PEOPLE[id],
  }));
  return installDouble(
    {
      users,
      user_profiles: users.map((u) => ({
        user_id: u.id,
        effective_band: u.role === "child" ? "intermediate" : u.role === "teen" ? "teen" : "adult",
      })),
      treatment_studies: [
        { id: STUDY, study_code: "privacy_pilot_2026", status: "active", auto_enroll: true, current_sample_size: 0 },
      ],
      treatment_dimensions: [
        { id: D_DEFAULT, name: "privacy_default", levels: ["private", "neutral", "public"], is_active: true },
      ],
      treatment_study_dimensions: [
        { study_id: STUDY, dimension_id: D_DEFAULT, sort_order: 0, active_levels: ["public", "private"] },
      ],
      consent_records: [],
      study_enrollments: [],
      survey_schedules: [],
      behavioral_events: [],
      points_ledger: [],
      referral_codes: [{ user_id: "teen", code: "TEEN2345" }, { user_id: "adult", code: "ADLT2345" }],
      minion_links: [],
      ...extra,
    },
    { authTokens: Object.fromEntries((Object.keys(PEOPLE) as Who[]).map((w) => [`tok-${w}`, { id: `auth-${w}` }])) }
  );
}

function consent(who: Who, body: Row) {
  return postConsent(
    new NextRequest("http://localhost/api/v1/consent", {
      method: "POST",
      headers: { authorization: `Bearer tok-${who}`, "content-type": "application/json" },
      body: JSON.stringify({ consent_type: "research", form_version: "1.1", ...body }),
    })
  );
}

const grantedConsent = (userId: string): Row => ({
  user_id: userId, consent_type: "research", granted: true, revoked_at: null, metadata: {},
});

describe("consent route: research consent is adults-only", () => {
  let db: SupabaseDouble;
  beforeEach(() => {
    db = seed();
  });

  it.each(["teen", "child", "kid18", "staff"] as const)("refuses any research decision from %s", async (who) => {
    expect((await consent(who, { granted: true, date_of_birth: "1990-01-01" })).status).toBe(403);
    expect((await consent(who, { granted: false })).status).toBe(403);
    expect(db.table("consent_records")).toHaveLength(0);
  });

  const parentDob = () => db.table("users").find((u) => u.id === "parent")!.date_of_birth;

  it("refuses a grant from an account with no date of birth unless one is given", async () => {
    const res = await consent("parent", { granted: true, age_attested: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/date of birth/i);
    expect(db.table("consent_records")).toHaveLength(0);
    expect(parentDob()).toBeNull();
  });

  it("refuses an invalid date of birth and saves nothing", async () => {
    for (const date_of_birth of ["1990-02-30", "2999-01-01", "1850-01-01", "yesterday"]) {
      expect((await consent("parent", { granted: true, date_of_birth })).status).toBe(400);
    }
    expect(db.table("consent_records")).toHaveLength(0);
    expect(parentDob()).toBeNull();
  });

  it("refuses an under-18 date of birth and saves nothing", async () => {
    const res = await consent("parent", { granted: true, date_of_birth: "2010-06-01" });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/18 or older/);
    expect(db.table("consent_records")).toHaveLength(0);
    expect(parentDob()).toBeNull();
  });

  it("saves an 18+ date of birth given at consent and records the age basis", async () => {
    expect((await consent("parent", { granted: true, date_of_birth: "1985-04-12" })).status).toBe(201);
    expect(parentDob()).toBe("1985-04-12");
    expect(db.table("consent_records")[0].metadata).toEqual({
      age_basis: "date_of_birth",
      date_of_birth_source: "consent_form",
    });
  });

  it("uses the date of birth on file and never overwrites it from the request", async () => {
    expect((await consent("adult", { granted: true, date_of_birth: "2015-01-01" })).status).toBe(201);
    expect(db.table("users").find((u) => u.id === "adult")!.date_of_birth).toBe("1999-01-01");
    expect(db.table("consent_records")[0].metadata).toEqual({
      age_basis: "date_of_birth",
      date_of_birth_source: "account",
    });
  });

  it("does not let client metadata forge the age basis or the legacy attestation", async () => {
    const forged = { [AGE_ATTESTATION_KEY]: true, age_basis: "date_of_birth", date_of_birth_source: "account" };
    expect((await consent("parent", { granted: true, metadata: forged })).status).toBe(400);
    await consent("parent", { granted: false, metadata: { ...forged, note: "x" } });
    expect(db.table("consent_records")[0].metadata).toEqual({ note: "x" });
  });

  it("records a decline without needing a date of birth", async () => {
    expect((await consent("adult", { granted: false })).status).toBe(201);
    expect((await consent("parent", { granted: false })).status).toBe(201);
    expect(parentDob()).toBeNull();
  });
});

describe("enrollment never randomizes an ineligible user, even with a consent on file", () => {
  it.each(["teen", "child", "kid18", "staff"] as const)("%s with a legacy consent record stays un-enrolled", async (who) => {
    const db = seed({ consent_records: [grantedConsent(who)] });
    expect((await enrollParticipant(who)).enrolled).toBe(false);
    expect(db.table("study_enrollments")).toHaveLength(0);
    expect(db.table("dimension_assignments")).toHaveLength(0);
  });

  it("refuses a consented parent with no date of birth on file (e.g. a legacy attestation-only consent)", async () => {
    const db = seed({ consent_records: [grantedConsent("parent")] });
    expect((await enrollParticipant("parent")).enrolled).toBe(false);
    expect(db.table("study_enrollments")).toHaveLength(0);
  });

  it("enrolls a parent who gave an 18+ date of birth at consent, and an adult", async () => {
    const db = seed();
    expect((await consent("parent", { granted: true, date_of_birth: "1985-04-12" })).status).toBe(201);
    db.table("consent_records").push(grantedConsent("adult"));
    expect((await enrollParticipant("parent")).enrolled).toBe(true);
    expect((await enrollParticipant("adult")).enrolled).toBe(true);
    expect(db.table("study_enrollments")).toHaveLength(2);
  });
});

describe("non-participant defaults", () => {
  it("gives a never-enrolled user a private-leaning map and stamps it", async () => {
    const db = seed();
    expect(await applyNonParticipantDefaults("teen", "teen", {})).toBe(true);
    expect(await applyNonParticipantDefaults("child", "intermediate", {})).toBe(true);
    const teen = db.table("users").find((u) => u.id === "teen")!;
    const child = db.table("users").find((u) => u.id === "child")!;
    expect(teen.profile_visibility).toEqual(nonParticipantDefaults("teen"));
    expect(child.profile_visibility).toEqual(nonParticipantDefaults("intermediate"));
    expect((teen.profile_visibility as Row).real_name).toBe("nobody");
    expect((teen.profile_visibility as Row).personality_scores).toBe("nobody");
    expect(typeof (teen.metadata as Row)[NON_PARTICIPANT_DEFAULTS_KEY]).toBe("string");
  });

  it("never touches a map the user already has, or an enrolled participant's (neutral) empty map", async () => {
    const db = seed({ study_enrollments: [{ study_id: STUDY, user_id: "adult", withdrawn_at: null }] });
    expect(await applyNonParticipantDefaults("adult", "adult", {})).toBe(false);
    expect(db.table("users").find((u) => u.id === "adult")!.profile_visibility).toEqual({});
    expect(await applyNonParticipantDefaults("teen", "teen", { total_score: "everyone" })).toBe(false);
  });

  it("gives way to the assigned condition when an adult later consents", async () => {
    const db = seed();
    await applyNonParticipantDefaults("adult", "adult", {});
    db.replace("consent_records", [grantedConsent("adult")]);
    expect((await enrollParticipant("adult")).enrolled).toBe(true);
    const user = db.table("users").find((u) => u.id === "adult")!;
    const meta = user.metadata as Row;
    const expected = meta.privacy_default === "public" ? "everyone" : "nobody";
    expect(new Set(Object.values(user.profile_visibility as Row))).toEqual(new Set([expected]));
    expect(meta[NON_PARTICIPANT_DEFAULTS_KEY]).toBeUndefined();
  });

  it("keeps a map the adult changed before consenting", async () => {
    const db = seed();
    await applyNonParticipantDefaults("adult", "adult", {});
    const user = db.table("users").find((u) => u.id === "adult")!;
    const mine = { ...(user.profile_visibility as Row), total_score: "everyone" };
    user.profile_visibility = mine;
    db.replace("consent_records", [grantedConsent("adult")]);
    expect((await enrollParticipant("adult")).enrolled).toBe(true);
    expect(user.profile_visibility).toEqual(mine);
  });
});

describe("referral gate applies to active study participants only", () => {
  const share = Math.round(100 * REFERRAL_FRACTION);

  it("pays a hidden non-participant recruiter (a teen) with no forfeit", async () => {
    const db = seed();
    db.table("users").find((u) => u.id === "teen")!.profile_visibility = { ...HIDDEN };
    await redeemReferral("adult", "TEEN2345");
    await awardReferralPoints("adult", 100, "find-1", "hunt-1");
    expect(db.where("points_ledger", (r) => r.user_id === "teen" && r.source_type === "referral")).toHaveLength(1);
    expect(db.where("behavioral_events", (e) => e.event_type === "referral_bonus_forfeited")).toHaveLength(0);
    const [paid] = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_paid");
    expect(paid.payload).toMatchObject({ study_participant: false, referral_gate: "ungated", forfeit_notice: "silent" });
  });

  it("still forfeits for a hidden, enrolled, consented adult (study design unchanged)", async () => {
    const db = seed({
      consent_records: [grantedConsent("adult")],
      study_enrollments: [{ study_id: STUDY, user_id: "adult", withdrawn_at: null }],
    });
    db.table("users").find((u) => u.id === "adult")!.profile_visibility = { ...HIDDEN };
    await redeemReferral("parent", "ADLT2345");
    await awardReferralPoints("parent", 100, "find-1", "hunt-1");
    expect(db.where("points_ledger", (r) => r.user_id === "adult")).toHaveLength(0);
    const [forfeit] = db.where("behavioral_events", (e) => e.event_type === "referral_bonus_forfeited");
    expect(forfeit.payload).toMatchObject({ study_participant: true, referral_gate: "gated", share });
  });

  it("pays a withdrawn participant without the gate", async () => {
    const db = seed({
      consent_records: [grantedConsent("adult")],
      study_enrollments: [{ study_id: STUDY, user_id: "adult", withdrawn_at: "2026-10-01T00:00:00Z" }],
    });
    db.table("users").find((u) => u.id === "adult")!.profile_visibility = { ...HIDDEN };
    await redeemReferral("parent", "ADLT2345");
    await awardReferralPoints("parent", 100, "find-1", "hunt-1");
    expect(db.where("points_ledger", (r) => r.user_id === "adult")).toHaveLength(1);
  });
});
