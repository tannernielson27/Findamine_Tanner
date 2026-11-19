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
import { DEFAULT_STOP_RADIUS_M } from "@/lib/play/arrival-check";
import { ownOrLibraryFilter, parseLibraryFlag, readsAllContent } from "@/lib/hunts/content-access";
import { ID_CHUNK } from "@/lib/utils/paginate";

/** Location text players see at a stop; screened like other hunt content. */
const LOCATION_TEXT_FIELDS = ["name", "description", "address", "safety_notes"];

export async function GET(request: NextRequest) {
  try {
    // The location library is a hunt builder's tool. It lists places by area,
    // which would show a player where a hunt's stops are before they start
    // them (issue #16), so it is for the roles that can create locations, and
    // a builder sees the shared library and the places they made themselves:
    // another creator's places are where that creator's stops are.
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

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
        // The search covers every place; a builder keeps only theirs and the
        // library's. Ask for more than is returned, so other people's places
        // nearby don't crowd theirs out.
        max_results: readsAllContent(user.role) ? NEARBY_RESULTS : NEARBY_SCAN,
      });

      if (error) throw internalError("/api/v1/locations", error);
      return Response.json({ locations: await readableNearby(supabase, user, (data ?? []) as NearbyLocation[]) });
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
    } else if (!readsAllContent(user.role)) {
      query = query.or(ownOrLibraryFilter(user.id));
    }

    const { data, error } = await query;
    if (error) throw internalError("/api/v1/locations", error);

    return Response.json({ locations: data });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Places the area search returns, and how many it looks through to find a builder's own. */
const NEARBY_RESULTS = 50;
const NEARBY_SCAN = 500;

interface NearbyLocation {
  id: string;
}

/**
 * The area search returns every place nearby. Keep the ones this builder may
 * read: the shared library and their own (admins and researchers: all).
 */
async function readableNearby(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  user: { id: string; role: string },
  nearby: NearbyLocation[]
): Promise<NearbyLocation[]> {
  if (readsAllContent(user.role) || nearby.length === 0) return nearby.slice(0, NEARBY_RESULTS);
  const ids = nearby.map((l) => l.id);
  const readable = new Set<string>();
  // In chunks, so the request URL stays short however many places are nearby.
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await supabase
      .from("locations")
      .select("id")
      .in("id", ids.slice(i, i + ID_CHUNK))
      .or(ownOrLibraryFilter(user.id));
    if (error) throw internalError("/api/v1/locations", error);
    for (const row of data ?? []) readable.add(row.id as string);
  }
  return nearby.filter((l) => readable.has(l.id)).slice(0, NEARBY_RESULTS);
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
    const radiusMeters = parseRadius(body.radius_meters) ?? DEFAULT_STOP_RADIUS_M;
    assertCleanFields(
      { ...body, safety_notes: normalizeSafetyNotes(body.safety_notes) },
      LOCATION_TEXT_FIELDS
    );

    const isLibrary = parseLibraryFlag(body.is_library, user.role) ?? false;
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
      p_is_library: isLibrary,
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
          is_library: isLibrary,
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
