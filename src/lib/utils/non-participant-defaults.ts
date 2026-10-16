/**
 * Starting privacy settings for everyone OUTSIDE the research study: children,
 * teens, adults who decline or have not yet decided on consent, parents,
 * teachers, creators and staff.
 *
 * Why this exists: profile_visibility starts as `{}`, and an unset field is
 * enforced as "everyone" (resolveFieldLevel). Only enrollment ever wrote a
 * starting map, so every non-participant — including teens and children —
 * started with real name and personality scores visible to all users.
 *
 * Non-participants now start private-leaning: nothing is visible to
 * "everyone"; real name and personality scores are "nobody". Children use the
 * kids column of PROFILE_FIELDS, everyone else the teen column.
 *
 * Study participants are untouched: enrollment still writes the randomized
 * assigned default. A map written here is stamped in metadata so that an adult
 * who consents later still receives their assigned condition (enrollment treats
 * an untouched non-participant map as "no settings yet"); once the person
 * changes anything, it is theirs and enrollment never overwrites it.
 *
 * Migration 074 writes the same two maps in SQL; a test keeps them in sync.
 * Pure — no I/O.
 */

import { PROFILE_FIELDS, type VisibilityLevel } from "@/lib/utils/privacy";

/** users.metadata key stamped when the non-participant defaults are written. */
export const NON_PARTICIPANT_DEFAULTS_KEY = "non_participant_defaults_at";

const KID_BANDS = ["primary", "intermediate"];

/** The private-leaning starting map for a non-participant in this age band. */
export function nonParticipantDefaults(ageBand: string | null | undefined): Record<string, VisibilityLevel> {
  const kids = KID_BANDS.includes(ageBand ?? "");
  return Object.fromEntries(
    PROFILE_FIELDS.map((f) => [f.key, kids ? f.defaultKids : f.defaultTeens] as const)
  );
}

function sameMap(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}

/**
 * Whether a stored map is still exactly a non-participant default this app
 * wrote (stamp present, nothing changed since). Enrollment may replace such a
 * map with the participant's assigned condition. Pure.
 */
export function isUntouchedNonParticipantDefault(
  visibility: Record<string, unknown> | null | undefined,
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!visibility || typeof metadata?.[NON_PARTICIPANT_DEFAULTS_KEY] !== "string") return false;
  return KID_BANDS.concat("teen").some((band) => sameMap(visibility, nonParticipantDefaults(band)));
}
