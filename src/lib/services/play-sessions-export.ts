/**
 * dataset=play_sessions: one row per play session, keyed by the stable Study
 * ID (study_enrollments.participant_code) like every other dataset.
 *
 * Carries the clue delivery each session was played under, as recorded by
 * /play/start in play_sessions.metadata (see lib/play/clue-delivery.ts):
 *   clue_delivery     all_at_once | fixed_order | assigned_order | random_order
 *   clue_order_index  assigned_order only: the 0-based order group
 * and whether the hunt is a study hunt (hunt metadata `study_hunt`, "1"/"0").
 * Only those two allowlisted values leave the metadata, and only when they are
 * well-formed. Sessions from before a person's enrollment (pre-consent) and
 * withdrawn people are left out, matching the other datasets. Cells go through
 * the shared serializer, so the spreadsheet formula guard applies.
 */

import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { fetchAllByIds } from "@/lib/utils/paginate";
import { isClueDelivery, SESSION_ORDER_INDEX_KEY, CLUE_DELIVERY_KEY } from "@/lib/play/clue-delivery";
import { readStudyHunt } from "@/lib/hunts/delivery-lock";
import { serialize, type ExportConfig } from "@/lib/services/research-export";
import { daysBetween, loadActiveEnrollments } from "@/lib/services/pilot-export";

export const PLAY_SESSION_HEADERS = [
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
];

export interface SessionExportRow {
  id: string;
  user_id: string;
  hunt_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown> | null;
}

interface EnrollmentKey {
  user_id: string;
  participant_code: string;
  enrolled_at: string;
}

/** [clue_delivery, clue_order_index] from session metadata; "" when absent or malformed. Pure. */
export function sessionDeliveryColumns(metadata: Readonly<Record<string, unknown>> | null | undefined): [string, string] {
  const mode = metadata?.[CLUE_DELIVERY_KEY];
  const index = metadata?.[SESSION_ORDER_INDEX_KEY];
  return [
    isClueDelivery(mode) ? mode : "",
    typeof index === "number" && Number.isInteger(index) && index >= 0 ? String(index) : "",
  ];
}

/** Rows for enrolled people's sessions started on or after their enrollment. Pure. */
export function playSessionRows(
  enrollments: ReadonlyArray<EnrollmentKey>,
  sessions: ReadonlyArray<SessionExportRow>,
  studyHuntIds: ReadonlySet<string>
): string[][] {
  const byUser = new Map(enrollments.map((e) => [e.user_id, e]));
  return sessions.flatMap((s) => {
    const e = byUser.get(s.user_id);
    if (!e || !s.started_at || Date.parse(s.started_at) < Date.parse(e.enrolled_at)) return [];
    return [[
      e.participant_code,
      s.id,
      s.hunt_id,
      s.status,
      s.started_at,
      s.completed_at ?? "",
      daysBetween(e.enrolled_at, s.started_at),
      ...sessionDeliveryColumns(s.metadata),
      studyHuntIds.has(s.hunt_id) ? "1" : "0",
    ]];
  });
}

export async function generatePlaySessionsExport(config: ExportConfig): Promise<string> {
  const supabase = await createSupabaseServiceClient();
  const enrollments = await loadActiveEnrollments(supabase, config.studyId);
  if (enrollments.length === 0) return "";

  const sessions = await fetchAllByIds<SessionExportRow>(
    enrollments.map((e) => e.user_id),
    (ids, from, to) =>
      supabase
        .from("play_sessions")
        .select("id, user_id, hunt_id, status, started_at, completed_at, metadata")
        .in("user_id", ids)
        .order("started_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
  );

  const rows = playSessionRows(enrollments, sessions, await loadStudyHuntIds(supabase, sessions));
  if (rows.length === 0) return "";
  return serialize(PLAY_SESSION_HEADERS, rows, config.format);
}

/** Ids of the played hunts that are study hunts. Reads only the flag from each hunt's metadata. */
async function loadStudyHuntIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  sessions: ReadonlyArray<SessionExportRow>
): Promise<Set<string>> {
  const huntIds = [...new Set(sessions.map((s) => s.hunt_id))];
  if (huntIds.length === 0) return new Set();
  const hunts = await fetchAllByIds<{ id: string; metadata: Record<string, unknown> | null }>(huntIds, (ids, from, to) =>
    supabase.from("hunts").select("id, metadata").in("id", ids).order("id", { ascending: true }).range(from, to)
  );
  return new Set(hunts.filter((h) => readStudyHunt(h.metadata)).map((h) => h.id));
}
