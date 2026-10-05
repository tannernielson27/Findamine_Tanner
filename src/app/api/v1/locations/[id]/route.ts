import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { parseCoordinates, parseRadius } from "../validation";

type Supabase = Awaited<ReturnType<typeof createSupabaseServiceClient>>;

/** Locations are only editable by whoever created them (or admin/researcher). */
async function requireLocationOwner(
  supabase: Supabase,
  id: string,
  user: { id: string; role: string }
) {
  const { data: existing } = await supabase
    .from("locations")
    .select("created_by")
    .eq("id", id)
    .is("deleted_at", null)
    .single();

  if (!existing) throw new ApiError(404, "Location not found");
  if (existing.created_by !== user.id && !["admin", "researcher"].includes(user.role)) {
    throw new ApiError(403, "You can only change locations you created");
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createSupabaseServiceClient();

    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .eq("id", id)
      .is("deleted_at", null)
      .single();

    if (error || !data) throw new ApiError(404, "Location not found");

    return Response.json({ location: data });
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
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const supabase = await createSupabaseServiceClient();
    await requireLocationOwner(supabase, id, user);

    const allowedFields = [
      "name", "description", "address",
      "place_id", "location_type", "safety_notes", "is_library", "metadata",
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (updates.name !== undefined && !String(updates.name || "").trim()) {
      throw new ApiError(400, "Location name cannot be empty");
    }

    const radiusMeters = parseRadius(body.radius_meters);
    if (radiusMeters !== undefined) updates.radius_meters = radiusMeters;

    // Update lat/lng + geography if provided
    if (body.latitude !== undefined || body.longitude !== undefined) {
      const { lat, lng } = parseCoordinates(body.latitude, body.longitude);
      updates.latitude = lat;
      updates.longitude = lng;
      updates.coordinates = `SRID=4326;POINT(${lng} ${lat})`;
    }

    if (Object.keys(updates).length === 0) {
      throw new ApiError(400, "No editable fields provided");
    }

    const { data, error } = await supabase
      .from("locations")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new ApiError(500, error.message);

    return Response.json({ location: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const supabase = await createSupabaseServiceClient();
    await requireLocationOwner(supabase, id, user);

    const { error } = await supabase
      .from("locations")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new ApiError(500, error.message);

    return Response.json({ message: "Location deleted" });
  } catch (error) {
    return errorResponse(error);
  }
}
