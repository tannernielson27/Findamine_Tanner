import { NextRequest } from "next/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import {
  generateResearchExport,
  generateTrajectoryExport,
  generateEventsExport,
  type ExportFormat,
} from "@/lib/services/research-export";
import { generateStorylineEventsExport } from "@/lib/services/storyline-events-export";
import {
  generateAppEventsExport,
  generateQualtricsExport,
  generateWithdrawalsExport,
} from "@/lib/services/pilot-export";
import { generatePlaySessionsExport } from "@/lib/services/play-sessions-export";

const FORMATS: ExportFormat[] = ["csv", "tsv", "json"];

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const { searchParams } = new URL(request.url);
    const studyId = searchParams.get("study_id");
    const format = (searchParams.get("format") || "csv") as ExportFormat;
    // "participants" (one row per participant), "trajectory" (one row per
    // privacy-index snapshot), "events" (one row per raw privacy_event —
    // for survival models and flow-level friction funnels), or "storylines"
    // (one row per S6 notice / S4 check-in — for habituation curves).
    // Pilot (082): "qualtrics" (survey launches / finished taps), "app_events"
    // (screen views, app state, client errors, forfeit-notice events) and
    // "withdrawals" (Study ID + dates only). "play_sessions": one row per hunt
    // played, with its clue delivery mode and assigned order group (083).
    // Every dataset is keyed by Study ID.
    const dataset = searchParams.get("dataset") || "participants";

    if (!studyId) throw new ApiError(400, "study_id required");
    if (!FORMATS.includes(format)) throw new ApiError(400, `format must be one of: ${FORMATS.join(", ")}`);

    const content =
      dataset === "trajectory"
        ? await generateTrajectoryExport({ studyId, format })
        : dataset === "events"
          ? await generateEventsExport({ studyId, format })
          : dataset === "storylines"
            ? await generateStorylineEventsExport({ studyId, format })
            : dataset === "qualtrics"
              ? await generateQualtricsExport({ studyId, format })
              : dataset === "app_events"
                ? await generateAppEventsExport({ studyId, format })
                : dataset === "play_sessions"
                  ? await generatePlaySessionsExport({ studyId, format })
                : dataset === "withdrawals"
                  ? await generateWithdrawalsExport({ studyId, format })
                  : await generateResearchExport({ studyId, format });

    if (!content) {
      throw new ApiError(404, "No data found for this study");
    }

    const contentType =
      format === "json"
        ? "application/json"
        : format === "tsv"
          ? "text/tab-separated-values"
          : "text/csv";
    const ext = format === "json" ? "json" : format;
    const filename = `study_${studyId}_${dataset}.${ext}`;

    return new Response(content, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export const maxDuration = 60;
