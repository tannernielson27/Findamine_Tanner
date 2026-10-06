import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import {
  describeScheduleRows,
  parseScheduleInput,
  sameSchedule,
  sameTimepoint,
  summarizeSchedule,
  toScheduleRows,
  ScheduleValidationError,
  type ScheduleInput,
  type StoredScheduleRow,
} from "./schedule-config";

/**
 * The delivery schedule of one survey (`[id]` is the SURVEY id).
 *
 * A survey is only ever delivered from a survey_schedules row
 * (src/lib/services/survey-delivery.ts), so this is what turns an authored,
 * active survey into one participants actually receive. Admin/researcher only.
 *
 *   GET     the schedule, a plain-language summary, and how much data exists
 *   PUT     create or replace it   (body: see parseScheduleInput)
 *   DELETE  remove it
 *
 * survey_schedules has no unique constraint and no study column, so two things
 * are enforced here instead of by the schema:
 *   - one logical schedule per survey: PUT replaces every existing row;
 *   - timepoints are global: the privacy-page gate and the research export key
 *     on trigger_config.timepoint, so an ACTIVE schedule may not share its
 *     timepoint with another survey's active schedule (409 timepoint_conflict).
 *
 * Writes that change what participants receive on a survey that already has
 * deliveries or responses, or that overlap an inactive schedule's timepoint,
 * answer 409 `confirmation_required` with the reasons; repeat the request with
 * `confirm: true` (PUT body) or `?confirm=true` (DELETE) to proceed.
 */

type Db = Awaited<ReturnType<typeof createSupabaseServiceClient>>;
type Params = { params: Promise<{ id: string }> };

interface SurveyRow {
  id: string;
  title: string;
  status: string;
}

interface TimepointClash {
  survey_id: string;
  title: string;
  survey_status: string;
  schedule_active: boolean;
}

async function loadSurvey(supabase: Db, surveyId: string): Promise<SurveyRow> {
  const { data } = await supabase
    .from("surveys")
    .select("id, title, status")
    .eq("id", surveyId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!data) throw new ApiError(404, "Survey not found");
  return data as SurveyRow;
}

async function loadRows(supabase: Db, surveyId: string): Promise<StoredScheduleRow[]> {
  const { data, error } = await supabase
    .from("survey_schedules")
    .select("id, survey_id, trigger_type, trigger_config, active")
    .eq("survey_id", surveyId)
    .order("created_at", { ascending: true });
  if (error) throw new ApiError(500, error.message);
  return (data || []) as StoredScheduleRow[];
}

async function countFor(supabase: Db, table: "survey_deliveries" | "survey_responses", surveyId: string) {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("survey_id", surveyId);
  if (error) throw new ApiError(500, error.message);
  return count || 0;
}

/** Other surveys holding a schedule with this timepoint (one entry per survey). */
async function findTimepointClashes(supabase: Db, surveyId: string, timepoint: string): Promise<TimepointClash[]> {
  const { data, error } = await supabase
    .from("survey_schedules")
    .select("survey_id, trigger_config, active, surveys(title, status)")
    .neq("survey_id", surveyId);
  if (error) throw new ApiError(500, error.message);

  const bySurvey = new Map<string, TimepointClash>();
  for (const row of data || []) {
    const cfg = (row.trigger_config || {}) as { timepoint?: unknown };
    if (typeof cfg.timepoint !== "string" || !sameTimepoint(cfg.timepoint, timepoint)) continue;
    const joined = row.surveys as unknown as SurveyRow | SurveyRow[] | null;
    const survey = Array.isArray(joined) ? joined[0] : joined;
    const active = row.active !== false;
    const seen = bySurvey.get(row.survey_id);
    bySurvey.set(row.survey_id, {
      survey_id: row.survey_id,
      title: survey?.title || "Untitled survey",
      survey_status: survey?.status || "unknown",
      schedule_active: active || Boolean(seen?.schedule_active),
    });
  }
  return [...bySurvey.values()];
}

function dataWarning(deliveries: number, responses: number, action: "Changing" | "Removing"): string | null {
  if (deliveries === 0 && responses === 0) return null;
  const consequence =
    action === "Removing"
      ? "Participants who have not received it yet never will, and it drops out of the per-timepoint export columns."
      : "Participants who already received it keep their existing delivery and deadline; only those not yet sent it follow the new schedule, so timing will differ within the sample.";
  return `This survey already has ${deliveries} deliver${deliveries === 1 ? "y" : "ies"} and ${responses} response${responses === 1 ? "" : "s"}. ${consequence}`;
}

function confirmationRequired(warnings: string[]) {
  return Response.json(
    {
      error: "Confirmation required before changing this schedule.",
      code: "confirmation_required",
      warnings,
    },
    { status: 409 }
  );
}

function scheduleBody(survey: SurveyRow, rows: StoredScheduleRow[], deliveries: number, responses: number) {
  const { schedule, unmanaged_rows } = describeScheduleRows(rows);
  return {
    schedule,
    summary: schedule ? summarizeSchedule(schedule) : null,
    unmanaged_rows,
    survey_status: survey.status,
    /** What the delivery service acts on: an active schedule on an active survey. */
    delivering: Boolean(schedule?.active) && survey.status === "active",
    deliveries,
    responses,
  };
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const supabase = await createSupabaseServiceClient();
    const survey = await loadSurvey(supabase, surveyId);
    const [rows, deliveries, responses] = await Promise.all([
      loadRows(supabase, surveyId),
      countFor(supabase, "survey_deliveries", surveyId),
      countFor(supabase, "survey_responses", surveyId),
    ]);
    return Response.json(scheduleBody(survey, rows, deliveries, responses));
  } catch (error) {
    return errorResponse(error);
  }
}

function parseOr400(body: unknown): ScheduleInput {
  try {
    return parseScheduleInput(body);
  } catch (error) {
    if (error instanceof ScheduleValidationError) throw new ApiError(400, error.message);
    throw error;
  }
}

export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json().catch(() => null);
    const input = parseOr400(body);
    const confirmed = (body as { confirm?: unknown }).confirm === true;

    const supabase = await createSupabaseServiceClient();
    const survey = await loadSurvey(supabase, surveyId);
    const [oldRows, deliveries, responses] = await Promise.all([
      loadRows(supabase, surveyId),
      countFor(supabase, "survey_deliveries", surveyId),
      countFor(supabase, "survey_responses", surveyId),
    ]);
    const existing = describeScheduleRows(oldRows);

    // Saving the stored schedule again changes nothing; answer without writing.
    if (existing.unmanaged_rows === 0 && sameSchedule(existing.schedule, input)) {
      return Response.json(scheduleBody(survey, oldRows, deliveries, responses));
    }

    const timepoint = input.trigger_config.timepoint;
    const clashes = await findTimepointClashes(supabase, surveyId, timepoint);
    const activeClashes = clashes.filter((c) => c.schedule_active);
    if (input.active && activeClashes.length > 0) {
      const names = activeClashes.map((c) => `"${c.title}" (${c.survey_status})`).join(", ");
      return Response.json(
        {
          error: `Timepoint ${timepoint} already has an active schedule on ${names}. Timepoints are shared by every study: two active ${timepoint} surveys would both be sent to each participant and would overwrite each other in the ${timepoint} export columns. Turn off or remove that schedule first, or pick another timepoint.`,
          code: "timepoint_conflict",
          conflicts: activeClashes,
        },
        { status: 409 }
      );
    }

    const warnings: string[] = [];
    const data = dataWarning(deliveries, responses, "Changing");
    if (data) warnings.push(data);
    if (clashes.length > 0) {
      const names = clashes.map((c) => `"${c.title}"`).join(", ");
      warnings.push(
        `Timepoint ${timepoint} is also used by ${names}. Only one of them is switched on, so only one is sent, but the research export reports both surveys under the same ${timepoint} columns.`
      );
    }
    if (existing.unmanaged_rows > 0) {
      warnings.push(
        `This survey has ${existing.unmanaged_rows} other schedule row${existing.unmanaged_rows === 1 ? "" : "s"} this editor does not manage; saving replaces ${existing.unmanaged_rows === 1 ? "it" : "them"}.`
      );
    }
    if (warnings.length > 0 && !confirmed) return confirmationRequired(warnings);

    // Insert the new rows, then delete the old ones by id, so a failed insert
    // leaves the stored schedule untouched. Both sets briefly coexisting is
    // harmless: delivery dedupes per survey per user.
    const { data: inserted, error: insError } = await supabase
      .from("survey_schedules")
      .insert(toScheduleRows(surveyId, input))
      .select("id, survey_id, trigger_type, trigger_config, active");
    if (insError) throw new ApiError(500, insError.message);
    const newRows = (inserted || []) as StoredScheduleRow[];

    const oldIds = oldRows.map((r) => r.id as string);
    if (oldIds.length > 0) {
      const { error: delError } = await supabase.from("survey_schedules").delete().in("id", oldIds);
      if (delError) {
        // Roll back so the survey isn't left with both schedules.
        await supabase.from("survey_schedules").delete().in("id", newRows.map((r) => r.id as string));
        throw new ApiError(500, delError.message);
      }
    }

    return Response.json(scheduleBody(survey, newRows, deliveries, responses));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id: surveyId } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const confirmed = new URL(request.url).searchParams.get("confirm") === "true";

    const supabase = await createSupabaseServiceClient();
    const survey = await loadSurvey(supabase, surveyId);
    const [rows, deliveries, responses] = await Promise.all([
      loadRows(supabase, surveyId),
      countFor(supabase, "survey_deliveries", surveyId),
      countFor(supabase, "survey_responses", surveyId),
    ]);

    if (rows.length > 0) {
      const warning = dataWarning(deliveries, responses, "Removing");
      if (warning && !confirmed) return confirmationRequired([warning]);

      const { error } = await supabase
        .from("survey_schedules")
        .delete()
        .in("id", rows.map((r) => r.id as string));
      if (error) throw new ApiError(500, error.message);
    }

    return Response.json({ ...scheduleBody(survey, [], deliveries, responses), removed: rows.length });
  } catch (error) {
    return errorResponse(error);
  }
}
