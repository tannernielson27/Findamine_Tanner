/**
 * Survey delivery cron (Workstream A / Task A7).
 *
 * Materializes due survey_deliveries for enrolled, non-withdrawn participants and
 * expires stale pending deliveries. CRON_SECRET auth (same as other crons).
 */

import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  createDueDeliveriesForUser,
  expireStaleDeliveries,
  sendSurveyReminders,
} from "@/lib/services/survey-delivery";
import { notifyOpenSurveyWaves } from "@/lib/services/qualtrics-surveys";
import { IN_APP_SURVEYS_ENABLED } from "@/lib/research/study-config";

export const maxDuration = 60;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const secret = process.env.CRON_SECRET;
  if (!secret || !auth || !safeCompare(auth, `Bearer ${secret}`)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Qualtrics waves (the pilot's source of record): one bell item per open wave.
  let studySurveyNotices = 0;
  let studySurveyError: string | null = null;
  try {
    studySurveyNotices = await notifyOpenSurveyWaves();
  } catch (err) {
    studySurveyError = err instanceof Error ? err.message : String(err);
    console.error(`[cron/survey-deliveries] study survey notifications failed: ${studySurveyError}`);
  }

  if (!IN_APP_SURVEYS_ENABLED) {
    return Response.json(
      { in_app_surveys: "disabled", study_survey_notices: studySurveyNotices, study_survey_error: studySurveyError },
      { status: studySurveyError ? 500 : 200 }
    );
  }

  const supabase = await createSupabaseServiceClient();

  const { data: enrollments } = await supabase
    .from("study_enrollments")
    .select("user_id, enrolled_at")
    .is("withdrawn_at", null);

  let created = 0;
  for (const e of enrollments || []) {
    created += await createDueDeliveriesForUser(e.user_id, e.enrolled_at);
  }

  const expired = await expireStaleDeliveries();
  const reminders = await sendSurveyReminders();

  return Response.json(
    {
      participants: (enrollments || []).length,
      deliveries_created: created,
      deliveries_expired: expired,
      reminders_sent: reminders,
      study_survey_notices: studySurveyNotices,
      study_survey_error: studySurveyError,
    },
    { status: studySurveyError ? 500 : 200 }
  );
}
