import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { canAccessHunt } from "@/lib/hunts/review";
import { logger } from "@/lib/utils/logger";

type Row = Record<string, unknown>;

// Columns the database fills in itself, stripped before re-inserting a row.
// hunts.search_vector is GENERATED ALWAYS (migration 005) and rejects any
// explicit value; finds, locations, tasks and primers have no generated or
// identity columns as of migration 069.
const SERVER_MANAGED = ["id", "created_at", "updated_at", "deleted_at"];
const HUNT_GENERATED = ["search_vector"];
// A copy is a new, unreviewed hunt: it starts outside the review queue.
const HUNT_REVIEW = [
  "review_status", "review_reason", "review_submitted_at", "reviewed_at", "reviewed_by",
  "safety_affirmed_at", "safety_affirmed_by",
];

function omit(row: Row, keys: string[]): Row {
  const copy: Row = { ...row };
  for (const key of keys) delete copy[key];
  return copy;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const { searchParams } = new URL(request.url);
    const deep = searchParams.get("deep") === "true";

    const supabase = await createSupabaseServiceClient();

    // Get source hunt with finds and their nested relations
    const { data: source, error: fetchError } = await supabase
      .from("hunts")
      .select("*, finds(*, locations(*), tasks(*), primers(*))")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (fetchError || !source) throw new ApiError(404, "Hunt not found");

    // Someone else's draft, or a hunt not yet approved for the public
    // catalogue, is not visible to them, so it is not clonable.
    if (!(await canAccessHunt(supabase, source, user))) throw new ApiError(404, "Hunt not found");

    const { finds, ...sourceHunt } = source as Row & { finds: Row[] | null };
    const huntData = omit(sourceHunt, [...SERVER_MANAGED, ...HUNT_GENERATED, ...HUNT_REVIEW]);

    const { data: newHunt, error: huntError } = await supabase
      .from("hunts")
      .insert({
        ...huntData,
        title: `${huntData.title} (Copy)`,
        status: "draft",
        is_public: false,
        source_template_id: id,
        created_by: user.id,
      })
      .select()
      .single();

    if (huntError || !newHunt) {
      logger.error("hunt.clone.hunt_failed", { huntId: id, error: huntError?.message });
      throw new ApiError(500, "Couldn't copy the hunt. Please try again.");
    }

    // Clone finds
    // By default (shallow): finds keep their original location_id, task_id, primer_id
    // foreign keys, referencing shared library resources. This is intentional —
    // locations, tasks, and primers are reusable (see is_library flag).
    //
    // With ?deep=true: sub-resources are also cloned as independent copies
    // owned by the current user, so edits won't affect the originals.
    //
    // Removed (soft-deleted) stops are not copied, and the copies are
    // renumbered 0..n-1 so the clone starts with a clean ordering.
    const liveFinds = (finds || [])
      .filter((f) => !f.deleted_at)
      .sort((a, b) => (a.sort_order as number) - (b.sort_order as number));

    try {
      // Dedup maps for deep clone (same resource referenced by multiple finds → clone once)
      const cloned = {
        locations: new Map<string, string>(), // old_id → new_id
        tasks: new Map<string, string>(),
        primers: new Map<string, string>(),
      };

      const cloneResource = async (
        table: "locations" | "tasks" | "primers",
        oldId: string | null,
        row: Row | null
      ): Promise<string | null> => {
        if (!oldId || !row) return oldId;
        const existing = cloned[table].get(oldId);
        if (existing) return existing;

        const data = omit(row, SERVER_MANAGED);
        if (table === "locations") {
          // Rebuild the PostGIS point from lat/lng rather than echoing back
          // whatever wire format the geography column was read in.
          data.coordinates = `SRID=4326;POINT(${row.longitude} ${row.latitude})`;
        }
        const { data: created, error } = await supabase
          .from(table)
          .insert({ ...data, is_library: false, created_by: user.id })
          .select("id")
          .single();
        if (error || !created) {
          logger.error("hunt.clone.resource_failed", { huntId: id, table, error: error?.message });
          throw new ApiError(500, "Couldn't copy the hunt's stops. Please try again.");
        }
        cloned[table].set(oldId, created.id as string);
        return created.id as string;
      };

      for (const [index, f] of liveFinds.entries()) {
        const { locations, tasks, primers, ...rest } = f as Row & {
          locations: Row | null;
          tasks: Row | null;
          primers: Row | null;
        };
        const findData = omit(rest, [...SERVER_MANAGED, "hunt_id"]);

        let locationId = (findData.location_id as string | null) ?? null;
        let taskId = (findData.task_id as string | null) ?? null;
        let primerId = (findData.primer_id as string | null) ?? null;

        if (deep) {
          locationId = await cloneResource("locations", locationId, locations);
          taskId = await cloneResource("tasks", taskId, tasks);
          primerId = await cloneResource("primers", primerId, primers);
        }

        const { error: findError } = await supabase.from("finds").insert({
          ...findData,
          hunt_id: newHunt.id,
          location_id: locationId,
          task_id: taskId,
          primer_id: primerId,
          sort_order: index,
        });
        if (findError) {
          logger.error("hunt.clone.find_failed", { huntId: id, stop: index + 1, error: findError.message });
          throw new ApiError(500, `Couldn't copy stop ${index + 1}. Please try again.`);
        }
      }
    } catch (copyError) {
      // Don't leave a half-copied hunt behind looking like a finished clone.
      await supabase.from("hunts").delete().eq("id", newHunt.id);
      throw copyError;
    }

    return Response.json({ hunt: newHunt, deep, stops_copied: liveFinds.length }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
