import { NextRequest } from "next/server";
import { getAuthUser, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { isQualtricsWave } from "@/lib/research/qualtrics";
import { getParticipantSurveys, isStudyRunning, recordQualtricsAction } from "@/lib/services/qualtrics-surveys";

/**
 * The CURRENT participant's Study ID and Qualtrics surveys (pilot 2026-11).
 * Self-scoped: there is no user parameter. Non-participants get
 * `{ enrolled: false }` and never see a Study ID.
 *
 * GET  → { enrolled, study_running, participant_code, waves: [{ wave, title, minutes, status, opens_at, url }] }
 *      study_running: any study is active (Settings hides the /debrief link then).
 * POST { wave, action: "launched" | "marked_done", platform?, app_version? }
 *      Records that a link was opened, or that the participant says they finished.
 */

const ACTIONS = ["launched", "marked_done"] as const;
type Action = (typeof ACTIONS)[number];

function shortText(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await generalLimiter.check(request, user.id);

    const [surveys, studyRunning] = await Promise.all([getParticipantSurveys(user.id), isStudyRunning()]);
    if (!surveys) return Response.json({ enrolled: false, study_running: studyRunning });
    return Response.json({
      enrolled: true,
      study_running: studyRunning,
      participant_code: surveys.participantCode,
      waves: surveys.waves.map((w) => ({
        wave: w.wave,
        title: w.title,
        minutes: w.minutes,
        status: w.status,
        opens_at: w.opensAt,
        url: w.url,
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");
    await generalLimiter.check(request, user.id);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const wave = body?.wave;
    const action = body?.action;
    if (!isQualtricsWave(wave)) throw new ApiError(400, "wave is not a survey of this study");
    if (typeof action !== "string" || !ACTIONS.includes(action as Action)) {
      throw new ApiError(400, "action must be launched or marked_done");
    }

    const surveys = await getParticipantSurveys(user.id);
    if (!surveys) throw new ApiError(403, "Not taking part in the study");
    // Only a wave that is open now can be launched or marked finished.
    const view = surveys.waves.find((w) => w.wave === wave);
    if (!view || view.status !== "open") throw new ApiError(409, "That survey is not open");

    await recordQualtricsAction({
      studyId: surveys.studyId,
      userId: user.id,
      wave,
      action: action as Action,
      platform: shortText(body?.platform, 16),
      appVersion: shortText(body?.app_version, 40),
    });
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
