import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
} from "@/lib/utils/api-auth";
import { parseCoordinates, parseRadius } from "./validation";
import { normalizeSafetyNotes } from "@/lib/play/safety";
import { assertCleanFields } from "@/lib/utils/crud-helpers";
import { internalError } from "@/lib/utils/internal-error";

/** Location text players see at a stop; screened like other hunt content. */
const LOCATION_TEXT_FIELDS = ["name", "description", "address", "safety_notes"];

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    if (!user) throw new ApiError(401, "Not authenticated");

    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const radius = searchParams.get("radius") || "5000";
    const library = searchParams.get("library");

    const supabase = await createSupabaseServiceClient();

    // Nearby search
    if (lat && lng) {
      const { data, error } = await supabase.rpc("nearby_locations", {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        radius_m: parseFloat(radius),
        max_results: 50,
      });

      if (error) throw internalError("/api/v1/locations", error);
      return Response.json({ locations: data });
    }

    // Library or all
    let query = supabase
      .from("locations")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);

    if (library === "true") {
      query = query.eq("is_library", true);
    }

    const { data, error } = await query;
    if (error) throw internalError("/api/v1/locations", error);

    return Response.json({ locations: data });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    if (!body.name || !String(body.name).trim()) {
      throw new ApiError(400, "Location name is required");
    }
    const { lat, lng } = parseCoordinates(body.latitude, body.longitude);
    const radiusMeters = parseRadius(body.radius_meters) ?? 50;
    assertCleanFields(
      { ...body, safety_notes: normalizeSafetyNotes(body.safety_notes) },
      LOCATION_TEXT_FIELDS
    );

    const supabase = await createSupabaseServiceClient();

    // Insert with raw SQL for PostGIS geography column
    const { data, error } = await supabase.rpc("insert_location", {
      p_name: body.name,
      p_description: body.description || null,
      p_latitude: lat,
      p_longitude: lng,
      p_radius_meters: radiusMeters,
      p_address: body.address || null,
      p_place_id: body.place_id || null,
      p_location_type: body.location_type || null,
      p_safety_notes: normalizeSafetyNotes(body.safety_notes),
      p_is_library: body.is_library || false,
      p_created_by: user.id,
    });

    if (error) {
      // Fallback: insert without PostGIS function if it doesn't exist yet
      const { data: loc, error: insertError } = await supabase
        .from("locations")
        .insert({
          name: body.name,
          description: body.description || null,
          latitude: lat,
          longitude: lng,
          coordinates: `SRID=4326;POINT(${lng} ${lat})`,
          radius_meters: radiusMeters,
          address: body.address || null,
          place_id: body.place_id || null,
          location_type: body.location_type || null,
          safety_notes: normalizeSafetyNotes(body.safety_notes),
          is_library: body.is_library || false,
          created_by: user.id,
        })
        .select()
        .single();

      if (insertError) throw internalError("/api/v1/locations", insertError);
      return Response.json({ location: loc }, { status: 201 });
    }

    return Response.json({ location: data }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
