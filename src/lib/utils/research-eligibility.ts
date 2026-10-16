/**
 * Who may be invited into, consent to, and be enrolled in the research study.
 *
 * Owner decision (2026-10-15): ONLY ADULTS may take part, and adulthood is
 * always established from a date of birth (never a self-attestation). This is
 * the single rule the (app) layout (whether the consent gate renders), the
 * consent route (whether a research consent may be recorded) and the
 * enrollment service (whether a user may be randomized) all call, so the three
 * can never drift.
 *
 * Invitable (`eligible: true`): an adult-capable role (adult, parent, teacher,
 * hunt_creator) whose date of birth, if on file, makes them 18 or older.
 *  - ageBasis "date_of_birth": an 18+ DOB is on file; they may consent and
 *    be enrolled (canJoinResearch).
 *  - ageBasis "needs_date_of_birth": no DOB on file (parent / teacher /
 *    hunt_creator register without one, see registration.ts). They still see
 *    the consent gate, but must give their date of birth there before they can
 *    join: the consent route refuses a grant without an 18+ DOB and saves it
 *    to users.date_of_birth, and enrollment refuses anyone without one.
 * Ineligible: children and teens (whatever their date of birth says), staff
 * (admin, researcher), unknown roles, and anyone whose date of birth is under
 * 18 or unparseable.
 *
 * Pure — no I/O — so it is unit tested directly (and safe in client code).
 */

import { ageInYears } from "@/lib/utils/registration";

export const RESEARCH_MIN_AGE = 18;

/** Roles that may be invited into the study (subject to the age check). */
export const RESEARCH_ELIGIBLE_ROLES = ["adult", "parent", "teacher", "hunt_creator"] as const;

/** Roles that are minors by definition. */
const MINOR_ROLES = ["child", "teen"] as const;
/** Staff run the study; they are never participants. */
const STAFF_ROLES = ["admin", "researcher"] as const;

export interface ResearchEligibilitySubject {
  role: string | null | undefined;
  date_of_birth?: string | null;
}

export type ResearchIneligibleReason = "minor_role" | "staff_role" | "unknown_role" | "under_18";

export type ResearchEligibility =
  | { eligible: true; ageBasis: "date_of_birth" }
  | { eligible: true; ageBasis: "needs_date_of_birth" }
  | { eligible: false; reason: ResearchIneligibleReason };

function includes(list: readonly string[], value: string | null | undefined): boolean {
  return typeof value === "string" && list.includes(value);
}

/**
 * Classify a user's research eligibility. `ageBasis` says whether adulthood is
 * already known from a date of birth, or still needs one (no DOB on file).
 */
export function researchEligibility(
  user: ResearchEligibilitySubject | null | undefined,
  now: number = Date.now()
): ResearchEligibility {
  const role = user?.role;
  if (includes(MINOR_ROLES, role)) return { eligible: false, reason: "minor_role" };
  if (includes(STAFF_ROLES, role)) return { eligible: false, reason: "staff_role" };
  if (!includes(RESEARCH_ELIGIBLE_ROLES, role)) return { eligible: false, reason: "unknown_role" };

  const dob = user?.date_of_birth;
  if (!dob) return { eligible: true, ageBasis: "needs_date_of_birth" };

  // NaN (unparseable date) fails the comparison, so a bad DOB is ineligible.
  return ageInYears(dob, now) >= RESEARCH_MIN_AGE
    ? { eligible: true, ageBasis: "date_of_birth" }
    : { eligible: false, reason: "under_18" };
}

/**
 * Whether the user may be shown the research-consent gate (invited). Includes
 * adult-capable accounts that still need to give a date of birth.
 */
export function isResearchInvitable(
  user: ResearchEligibilitySubject | null | undefined,
  now: number = Date.now()
): boolean {
  return researchEligibility(user, now).eligible;
}

/**
 * Whether the user may consent-and-be-enrolled right now: invitable AND an 18+
 * date of birth is on file. Enrollment and manual randomization use this.
 */
export function canJoinResearch(
  user: ResearchEligibilitySubject | null | undefined,
  now: number = Date.now()
): boolean {
  const result = researchEligibility(user, now);
  return result.eligible && result.ageBasis === "date_of_birth";
}

/** Earliest plausible date of birth accepted from the consent form. */
const MIN_BIRTH_YEAR = 1900;

export type ResearchDateOfBirthCheck =
  | { ok: true; dateOfBirth: string }
  | { ok: false; reason: "invalid" | "under_18" };

/**
 * Validate a date of birth typed into the consent dialog: a real calendar
 * date in YYYY-MM-DD form, from 1900 on, not in the future, and 18 or more
 * years ago (ageInYears, the same rule registration uses). Used by both the
 * dialog (to explain kindly) and the consent route (the authority).
 */
export function checkResearchDateOfBirth(
  value: unknown,
  now: number = Date.now()
): ResearchDateOfBirthCheck {
  if (typeof value !== "string") return { ok: false, reason: "invalid" };
  const text = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return { ok: false, reason: "invalid" };

  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!isRealDate || year < MIN_BIRTH_YEAR || date.getTime() > now) {
    return { ok: false, reason: "invalid" };
  }

  return ageInYears(text, now) >= RESEARCH_MIN_AGE
    ? { ok: true, dateOfBirth: text }
    : { ok: false, reason: "under_18" };
}

/**
 * LEGACY. Key on consent_records.metadata that recorded the "I am 18 or older"
 * attestation on research-consent grants made under consent form 1.1. New
 * grants record `age_basis: "date_of_birth"` instead (an 18+ DOB is required);
 * the key is kept so older records stay readable and so the consent route can
 * strip a client-sent copy of it.
 */
export const AGE_ATTESTATION_KEY = "attested_18_or_older";
