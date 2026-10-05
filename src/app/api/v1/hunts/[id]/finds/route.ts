import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { parseFindFields } from "../../find-fields";
import { canSeeAnswerKeys, redactAnswerKeys } from "../../redact-finds";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const supabase = await createSupabaseServiceClient();

    // Check if hunt is draft — only owner/admin can see draft hunt finds
    const { data: hunt } = await supabase
      .from("hunts")
      .select("status, created_by")
      .eq("id", id)
      .single();

    if (hunt?.status === "draft" && hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(404, "Hunt not found");
    }

    const { data: finds, error } = await supabase
      .from("finds")
      .select("*, locations(*), tasks(*), primers(*)")
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: true });

    if (error) throw new ApiError(500, error.message);

    const rows = finds || [];
    return Response.json({
      finds: canSeeAnswerKeys(user, hunt?.created_by ?? null) ? rows : redactAnswerKeys(rows),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const fields = parseFindFields(body);
    const supabase = await createSupabaseServiceClient();

    // Verify hunt ownership
    const { data: hunt } = await supabase
      .from("hunts")
      .select("created_by")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (!hunt) throw new ApiError(404, "Hunt not found");
    if (hunt.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
      throw new ApiError(403, "You can only add finds to your own hunts");
    }

    // Next sort order goes after the current last stop. (Counting live stops
    // instead would collide with an existing sort_order after any delete.)
    const { data: last } = await supabase
      .from("finds")
      .select("sort_order")
      .eq("hunt_id", id)
      .is("deleted_at", null)
      .order("sort_order", { ascending: false })
      .limit(1);
    const nextOrder = last && last.length > 0 ? (last[0].sort_order as number) + 1 : 0;

    const { data: find, error } = await supabase
      .from("finds")
      .insert({
        location_id: null,
        task_id: null,
        primer_id: null,
        sort_order: nextOrder,
        clue_text: null,
        hot_cold_enabled: true,
        metadata: {},
        ...fields,
        hunt_id: id,
      })
      .select("*, locations(*), tasks(*), primers(*)")
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ find }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
