import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const supabase = await createSupabaseServiceClient();

    // Verify ownership
    const { data: existing } = await supabase
      .from("hunts")
      .select("created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!existing) throw new ApiError(404, "Hunt not found");
    if (existing.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only publish your own hunts");
    }

    // Verify the hunt is actually playable: at least one stop, and every stop
    // has a real location players can walk to.
    const { data: finds, error: findsError } = await supabase
      .from("finds")
      .select("id, sort_order, location_id, metadata")
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    if (findsError) throw new ApiError(500, findsError.message);
    if (!finds || finds.length === 0) {
      throw new ApiError(400, "Add at least one stop before publishing this hunt");
    }

    type FindRow = { location_id: string | null; metadata: unknown };
    /** e.g. "stop 3 has" / "stops 1, 2 have" for the stops matching a problem, or "" if none. */
    const stopsThat = (matches: (find: FindRow) => boolean) => {
      const numbers = finds.flatMap((find, index) => (matches(find) ? [index + 1] : []));
      if (numbers.length === 0) return "";
      return numbers.length === 1 ? `stop ${numbers[0]} has` : `stops ${numbers.join(", ")} have`;
    };

    const missingLocation = stopsThat((f) => !f.location_id);
    if (missingLocation) {
      throw new ApiError(400, `Can't publish yet: ${missingLocation} no location. Edit to set one.`);
    }
    const needsPlacement = stopsThat(
      (f) => (f.metadata as { needs_placement?: boolean } | null)?.needs_placement === true
    );
    if (needsPlacement) {
      throw new ApiError(
        400,
        `Can't publish yet: ${needsPlacement} a placeholder location from the AI builder. Edit and move the pin to the real spot.`
      );
    }

    const { data: hunt, error } = await supabase
      .from("hunts")
      .update({ status: "published", is_public: true })
      .eq("id", id)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ hunt });
  } catch (error) {
    return errorResponse(error);
  }
}
