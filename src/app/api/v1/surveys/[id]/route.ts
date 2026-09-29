import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("surveys")
      .select("*, survey_responses(count)")
      .eq("id", id)
      .single();

    if (error || !data) throw new ApiError(404, "Survey not found");
    return Response.json({ survey: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();

    const updates: Record<string, unknown> = {};
    for (const f of ["title", "description", "questions", "status", "target_roles"]) {
      if (body[f] !== undefined) updates[f] = body[f];
    }
    if (updates.title !== undefined) {
      const title = typeof updates.title === "string" ? updates.title.trim() : "";
      if (!title) throw new ApiError(400, "Title is required");
      updates.title = title;
    }
    if (updates.description !== undefined) {
      const description = typeof updates.description === "string" ? updates.description.trim() : "";
      updates.description = description || null;
    }

    const { data, error } = await supabase
      .from("surveys")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);
    return Response.json({ survey: data });
  } catch (error) {
    return errorResponse(error);
  }
}
