import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  canJoinResearch,
  checkResearchDateOfBirth,
  isResearchInvitable,
  researchEligibility,
  RESEARCH_ELIGIBLE_ROLES,
} from "@/lib/utils/research-eligibility";
import {
  NON_PARTICIPANT_DEFAULTS_KEY,
  isUntouchedNonParticipantDefault,
  nonParticipantDefaults,
} from "@/lib/utils/non-participant-defaults";
import { getDefaults, PROFILE_FIELDS } from "@/lib/utils/privacy";
import { coordinatesForStorage, parseCoordinate } from "@/lib/utils/location-storage";
import {
  NON_PARTICIPANT_REFERRAL_SWITCHES,
  referralSwitchesFor,
} from "@/lib/services/referral";
import { isActiveParticipant } from "@/lib/services/participant-conditions";

const NOW = Date.parse("2026-10-15T12:00:00Z");

describe("researchEligibility (adults only)", () => {
  it("never admits children, teens or staff, whatever their date of birth says", () => {
    for (const role of ["child", "teen"]) {
      expect(researchEligibility({ role, date_of_birth: "1990-01-01" }, NOW)).toEqual({
        eligible: false,
        reason: "minor_role",
      });
    }
    for (const role of ["admin", "researcher"]) {
      expect(researchEligibility({ role, date_of_birth: "1990-01-01" }, NOW)).toEqual({
        eligible: false,
        reason: "staff_role",
      });
    }
  });

  it("refuses unknown or missing roles and missing users", () => {
    for (const user of [{ role: "superuser" }, { role: null }, null, undefined]) {
      expect(isResearchInvitable(user, NOW)).toBe(false);
      expect(canJoinResearch(user, NOW)).toBe(false);
    }
  });

  it("admits an adult role with a date of birth 18+ years ago, by date of birth", () => {
    expect(researchEligibility({ role: "adult", date_of_birth: "2008-10-01" }, NOW)).toEqual({
      eligible: true,
      ageBasis: "date_of_birth",
    });
  });

  it("refuses an adult-capable role whose date of birth is under 18", () => {
    for (const role of RESEARCH_ELIGIBLE_ROLES) {
      expect(researchEligibility({ role, date_of_birth: "2009-06-01" }, NOW)).toEqual({
        eligible: false,
        reason: "under_18",
      });
    }
  });

  it("refuses an unparseable date of birth", () => {
    expect(isResearchInvitable({ role: "adult", date_of_birth: "not-a-date" }, NOW)).toBe(false);
    expect(canJoinResearch({ role: "adult", date_of_birth: "not-a-date" }, NOW)).toBe(false);
  });

  it("invites parent / teacher / hunt_creator without a DOB, but they must give one before joining", () => {
    for (const role of ["parent", "teacher", "hunt_creator"]) {
      const user = { role, date_of_birth: null };
      expect(researchEligibility(user, NOW)).toEqual({ eligible: true, ageBasis: "needs_date_of_birth" });
      expect(isResearchInvitable(user, NOW)).toBe(true);
      expect(canJoinResearch(user, NOW)).toBe(false);
    }
  });

  it("lets an invitable role with an 18+ DOB on file join", () => {
    for (const role of RESEARCH_ELIGIBLE_ROLES) {
      expect(canJoinResearch({ role, date_of_birth: "1990-01-01" }, NOW)).toBe(true);
    }
  });
});

describe("checkResearchDateOfBirth", () => {
  it("accepts a real date 18+ years ago", () => {
    expect(checkResearchDateOfBirth("1990-02-28", NOW)).toEqual({ ok: true, dateOfBirth: "1990-02-28" });
    expect(checkResearchDateOfBirth(" 2008-10-01 ", NOW)).toEqual({ ok: true, dateOfBirth: "2008-10-01" });
  });

  it("refuses an under-18 date of birth as under_18", () => {
    expect(checkResearchDateOfBirth("2009-06-01", NOW)).toEqual({ ok: false, reason: "under_18" });
    expect(checkResearchDateOfBirth("2026-10-01", NOW)).toEqual({ ok: false, reason: "under_18" });
  });

  it("refuses missing, malformed, impossible, future and implausibly old dates as invalid", () => {
    for (const value of [undefined, null, "", 19900101, "1990-1-1", "01/02/1990", "1990-02-30", "1990-13-01", "2027-01-01", "1899-12-31", "abcd-ef-gh"]) {
      expect(checkResearchDateOfBirth(value, NOW)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("nonParticipantDefaults", () => {
  const SENSITIVE = ["real_name", "personality_scores"];

  it("covers every profile field and shows nothing to everyone, for every band", () => {
    for (const band of ["primary", "intermediate", "teen", "adult", "", null]) {
      const map = nonParticipantDefaults(band);
      expect(Object.keys(map).sort()).toEqual(PROFILE_FIELDS.map((f) => f.key).sort());
      expect(Object.values(map)).not.toContain("everyone");
      for (const key of SENSITIVE) expect(map[key]).toBe("nobody");
    }
  });

  it("uses the kids column for kids bands and the teen column for everyone else", () => {
    expect(nonParticipantDefaults("primary")).toEqual(getDefaults("primary"));
    expect(nonParticipantDefaults("intermediate")).toEqual(getDefaults("intermediate"));
    expect(nonParticipantDefaults("adult")).toEqual(getDefaults("teen"));
  });

  it("matches the maps migration 074 writes in SQL", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase", "migrations", "074_research_adults_only.sql"),
      "utf8"
    );
    const maps = [...sql.matchAll(/'(\{[^']*\})'::jsonb/g)].map((m) => JSON.parse(m[1]) as Record<string, string>);
    expect(maps).toContainEqual(nonParticipantDefaults("intermediate"));
    expect(maps).toContainEqual(nonParticipantDefaults("teen"));
    // The "untouched public condition" map the migration resets for withdrawn minors.
    expect(maps).toContainEqual(getDefaults("adult", "public"));
  });
});

describe("isUntouchedNonParticipantDefault", () => {
  const stamped = { [NON_PARTICIPANT_DEFAULTS_KEY]: "2026-10-15T00:00:00Z" };

  it("is true only for a stamped, unchanged default map", () => {
    expect(isUntouchedNonParticipantDefault(nonParticipantDefaults("adult"), stamped)).toBe(true);
    expect(isUntouchedNonParticipantDefault(nonParticipantDefaults("primary"), stamped)).toBe(true);
  });

  it("is false once the person changed anything, or without the stamp", () => {
    const changed = { ...nonParticipantDefaults("adult"), total_score: "everyone" };
    expect(isUntouchedNonParticipantDefault(changed, stamped)).toBe(false);
    expect(isUntouchedNonParticipantDefault(nonParticipantDefaults("adult"), {})).toBe(false);
    expect(isUntouchedNonParticipantDefault(nonParticipantDefaults("adult"), null)).toBe(false);
    expect(isUntouchedNonParticipantDefault(null, stamped)).toBe(false);
  });
});

describe("referral switches: study mechanics reach active participants only", () => {
  it("non-participants are ungated and never shown a forfeit notice, whatever their metadata", () => {
    expect(referralSwitchesFor({}, false)).toEqual(NON_PARTICIPANT_REFERRAL_SWITCHES);
    expect(
      referralSwitchesFor({ dim_referral_gate: "gated", dim_forfeit_notice: "shown" }, false)
    ).toEqual({ referral_gate: "ungated", forfeit_notice: "silent" });
  });

  it("active participants keep their assigned levels, and the study default (gated + shown) when unassigned", () => {
    expect(referralSwitchesFor({}, true)).toEqual({ referral_gate: "gated", forfeit_notice: "shown" });
    expect(referralSwitchesFor({ dim_forfeit_notice: "silent" }, true)).toEqual({
      referral_gate: "gated",
      forfeit_notice: "silent",
    });
  });
});

describe("isActiveParticipant", () => {
  const live = { participation: "participant" as const, metadata: {}, hasLiveConsent: true };

  it("requires an enrollment, no withdrawal stamp, and live consent", () => {
    expect(isActiveParticipant(live)).toBe(true);
    expect(isActiveParticipant({ ...live, participation: "none" })).toBe(false);
    expect(isActiveParticipant({ ...live, participation: "withdrawn" })).toBe(false);
    expect(isActiveParticipant({ ...live, metadata: { research_withdrawn_at: "2026-10-01" } })).toBe(false);
    expect(isActiveParticipant({ ...live, hasLiveConsent: false })).toBe(false);
  });
});

describe("coordinatesForStorage", () => {
  it("never keeps a child's coordinates", () => {
    expect(coordinatesForStorage("child", 40.25, -111.65)).toEqual({ latitude: null, longitude: null });
  });

  it("keeps coordinates for every other role", () => {
    for (const role of ["teen", "adult", "parent", "teacher"]) {
      expect(coordinatesForStorage(role, 40.25, -111.65)).toEqual({ latitude: 40.25, longitude: -111.65 });
    }
  });

  it("parses optional form coordinates", () => {
    expect(parseCoordinate("40.25")).toBe(40.25);
    expect(parseCoordinate("")).toBeNull();
    expect(parseCoordinate(null)).toBeNull();
    expect(parseCoordinate("abc")).toBeNull();
  });
});
