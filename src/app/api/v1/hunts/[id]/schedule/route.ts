import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";
import { internalError } from "@/lib/utils/internal-error";
import { logger } from "@/lib/utils/logger";
import { deliveryLocked } from "../../delivery-guard";
import { withClueDelivery } from "@/lib/play/clue-delivery";
import {
  SCHEDULE_LOCKED_MESSAGE,
  validateSchedule,
  withScheduleTimeZone,
  withoutScheduleTimeZone,
  type ScheduleInput,
} from "@/lib/hunts/schedule";

const ROUTE = "/api/v1/hunts/[id]/schedule";
const CHECK_VIOLATION = "23514";
const MAX_START_AHEAD_MS = 2 * 365 * 24 * 60 * 60 * 1000;

type Meta = Record<string, unknown> | null;

/** A request body value as a string, or "" (which the validation reports). */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseReleases(value: unknown): ScheduleInput["releases"] {
  if (!Array.isArray(value)) throw new ApiError(400, "releases must be a list of { find_id, release_at }");
  return value.map((entry) => {
    const row = (entry ?? {}) as { find_id?: unknown; release_at?: unknown };
    if (typeof row.find_id !== "string" || !row.find_id) throw new ApiError(400, "Each release needs a find_id");
    if (row.release_at !== null && typeof row.release_at !== "string") {
      throw new ApiError(400, "release_at must be a date and time, or null for the hunt's start");
    }
    return { findId: row.find_id, releaseAt: row.release_at };
  });
}

/**
 * PUT /api/v1/hunts/[id]/schedule
 *   { starts_at, ends_at, timezone, releases: [{ find_id, release_at | null }] }
 *   { clear: true }
 *
 * Makes the hunt a scheduled hunt (issue #14), or a play-anytime hunt again.
 * The whole schedule is saved in one request: the window, the zone the times
 * were entered in, and when each stop is released (null: at the start).
 *
 * Only the hunt's creator, an admin or a researcher, and only while the hunt
 * is an unplayed draft: the schedule shares the clue delivery lock (409 once
 * published or played; migration 087 has the database trigger).
 *
 * A scheduled hunt hands out every released clue at once, so saving a
 * schedule also sets clue delivery to "all at once".
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new ApiError(400, "A schedule is required");

    const supabase = await createSupabaseServiceClient();
    const { data: hunt, error: huntError } = await supabase
      .from("hunts")
      .select("id, created_by, status, metadata, starts_at, ends_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (huntError) throw internalError(ROUTE, huntError);
    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "Not authorized to edit this hunt");
    }
    if (await deliveryLocked(supabase, { id, status: hunt.status as string }, ROUTE)) {
      throw new ApiError(409, SCHEDULE_LOCKED_MESSAGE);
    }

    const { data: findRows, error: findsError } = await supabase
      .from("finds")
      .select("id")
      .eq("hunt_id", id)
      .is("deleted_at", null);
    if (findsError) throw internalError(ROUTE, findsError);
    const findIds = (findRows ?? []).map((f) => f.id as string);
    const metadata = (hunt.metadata as Meta) ?? null;

    if (body.clear === true) {
      // The window first: if the second write fails, the hunt is already a
      // play-anytime hunt and the release times left behind are never read.
      const cleared = withoutScheduleTimeZone(metadata);
      await saveWindow(supabase, id, { starts_at: null, ends_at: null, metadata: cleared });
      await saveReleases(supabase, id, findIds.map((findId) => ({ findId, releaseAt: null })));
      logger.info("hunt.schedule_cleared", { userId: user.id, huntId: id });
      return Response.json({ schedule: null, metadata: cleared });
    }

    const input: ScheduleInput = {
      startsAt: text(body.starts_at),
      endsAt: text(body.ends_at),
      timeZone: text(body.timezone),
      releases: parseReleases(body.releases),
    };
    if (findIds.length === 0) throw new ApiError(400, "Add the hunt's stops before scheduling it.");
    const check = validateSchedule(input, findIds);
    if (!check.ok) throw new ApiError(400, check.error);
    if (Date.parse(input.endsAt) <= Date.now()) {
      throw new ApiError(400, "The hunt's end has already passed. Choose an end in the future.");
    }
    if (Date.parse(input.startsAt) > Date.now() + MAX_START_AHEAD_MS) {
      throw new ApiError(400, "The hunt's start is more than two years away. Choose an earlier date.");
    }

    const startsAt = new Date(input.startsAt).toISOString();
    const endsAt = new Date(input.endsAt).toISOString();
    const releases = input.releases.map((r) => ({
      findId: r.findId,
      releaseAt: r.releaseAt === null ? null : new Date(r.releaseAt).toISOString(),
    }));
    // Every released clue is open at once on a scheduled hunt.
    const nextMetadata = withScheduleTimeZone(withClueDelivery(metadata, "all_at_once"), input.timeZone);

    // Releases first: if the window write fails, the hunt is still a
    // play-anytime hunt and the release times just written are never read.
    await saveReleases(supabase, id, releases);
    await saveWindow(supabase, id, { starts_at: startsAt, ends_at: endsAt, metadata: nextMetadata });
    logger.info("hunt.schedule_saved", { userId: user.id, huntId: id, startsAt, endsAt, stops: releases.length });

    return Response.json({
      schedule: {
        starts_at: startsAt,
        ends_at: endsAt,
        timezone: input.timeZone,
        releases: releases.map((r) => ({ find_id: r.findId, release_at: r.releaseAt })),
      },
      metadata: nextMetadata,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

type ServiceClient = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

async function saveReleases(
  supabase: ServiceClient,
  huntId: string,
  releases: ReadonlyArray<{ findId: string; releaseAt: string | null }>
): Promise<void> {
  const results = await Promise.all(
    releases.map((r) =>
      supabase.from("finds").update({ release_at: r.releaseAt }).eq("id", r.findId).eq("hunt_id", huntId)
    )
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw lockedOrInternal(failed.error);
}

/**
 * The database's own lock (migration 087) fired: the hunt was published or
 * played between this route's check and its write. Same answer as the check.
 */
function lockedOrInternal(error: { message?: string; code?: string }): ApiError {
  return error.code === CHECK_VIOLATION ? new ApiError(409, SCHEDULE_LOCKED_MESSAGE) : internalError(ROUTE, error);
}

async function saveWindow(
  supabase: ServiceClient,
  huntId: string,
  values: { starts_at: string | null; ends_at: string | null; metadata: Record<string, unknown> }
): Promise<void> {
  const { error } = await supabase.from("hunts").update(values).eq("id", huntId);
  if (error) throw lockedOrInternal(error);
}
