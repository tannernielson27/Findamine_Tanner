/**
 * A participant's own experimental conditions (Workstream B / Task B9).
 *
 * Reads the dimensions linked to the active study and the caller's assigned
 * level on each, so the debrief can disclose the manipulations actually in
 * force instead of hard-coded copy. Pure shaping helpers are exported for
 * tests; `getParticipantConditions` does the reads. Only ever returns the
 * given user's own assignments.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";

export interface StudySummary {
  code: string;
  name: string;
}

export interface ConditionDimension {
  name: string;
  label: string;
  description: string | null;
  levels: string[];
  assigned_level: string | null;
}

export interface ParticipantConditions {
  study: StudySummary | null;
  dimensions: ConditionDimension[];
}

/** "privacy_control_complexity" → "Privacy Control Complexity". Pure. */
export function humanizeDimensionName(name: string): string {
  return name
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export interface LinkedDimensionRow {
  dimension_id: string;
  sort_order?: number | null;
  /** Per-study level subset (migration 052); null/empty means every level. */
  active_levels?: string[] | null;
  treatment_dimensions:
    | { name: string; description: string | null; levels: string[] | null }
    | { name: string; description: string | null; levels: string[] | null }[]
    | null;
}

export interface AssignmentRow {
  dimension_id: string;
  level: string;
}

function unwrap<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Join linked dimensions with this user's assignments, in study sort order. Pure. */
export function buildConditionDimensions(
  linked: LinkedDimensionRow[],
  assignments: AssignmentRow[]
): ConditionDimension[] {
  const levelByDim = new Map(assignments.map((a) => [a.dimension_id, a.level]));
  return [...linked]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .flatMap((row) => {
      const dim = unwrap(row.treatment_dimensions);
      if (!dim?.name) return [];
      // Disclose only the versions this study actually ran.
      const all = dim.levels ?? [];
      const active = row.active_levels?.length ? all.filter((l) => row.active_levels!.includes(l)) : all;
      return [
        {
          name: dim.name,
          label: humanizeDimensionName(dim.name),
          description: dim.description ?? null,
          levels: active,
          assigned_level: levelByDim.get(row.dimension_id) ?? null,
        },
      ];
    });
}

/**
 * Where a user stands with the research study:
 *   participant — holds an enrollment that has not been withdrawn (enrollment
 *                 itself requires granted research consent)
 *   withdrawn   — was enrolled, every enrollment since withdrawn
 *   none        — never enrolled (declined consent, staff, pre-enrollment)
 */
export type ParticipationStatus = "participant" | "withdrawn" | "none";

/** Classify a user's study_enrollments rows. Pure. */
export function participationFromEnrollments(
  rows: readonly { withdrawn_at?: string | null }[]
): ParticipationStatus {
  if (rows.length === 0) return "none";
  return rows.some((r) => !r.withdrawn_at) ? "participant" : "withdrawn";
}

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * Read a user's participation status. Throws when the read fails, so callers
 * choose their own failure mode — study rows must never be written for someone
 * who may not be a participant.
 */
export async function getParticipationStatus(
  userId: string,
  client?: ServiceClient
): Promise<ParticipationStatus> {
  const supabase = client ?? (await createSupabaseServiceClient());
  const { data, error } = await supabase
    .from("study_enrollments")
    .select("withdrawn_at")
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return participationFromEnrollments(data || []);
}

/** Active auto-enroll study's dimensions + the user's own levels. Never throws. */
export async function getParticipantConditions(userId: string): Promise<ParticipantConditions> {
  const empty: ParticipantConditions = { study: null, dimensions: [] };
  try {
    const supabase = await createSupabaseServiceClient();

    const { data: study } = await supabase
      .from("treatment_studies")
      .select("id, study_code, name")
      .eq("auto_enroll", true)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (!study) return empty;

    const { data: linked } = await supabase
      .from("treatment_study_dimensions")
      .select("dimension_id, sort_order, active_levels, treatment_dimensions(name, description, levels)")
      .eq("study_id", study.id);
    const linkedRows = (linked || []) as LinkedDimensionRow[];

    const dimensionIds = linkedRows.map((r) => r.dimension_id);
    const { data: assignments } = dimensionIds.length
      ? await supabase
          .from("dimension_assignments")
          .select("dimension_id, level")
          .eq("user_id", userId)
          .in("dimension_id", dimensionIds)
      : { data: [] as AssignmentRow[] };

    return {
      study: { code: study.study_code, name: study.name },
      dimensions: buildConditionDimensions(linkedRows, assignments || []),
    };
  } catch {
    return empty;
  }
}
