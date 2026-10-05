import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { getAuthUser, requireRole, errorResponse, ApiError } from "@/lib/utils/api-auth";

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "admin");

    const range = new URL(request.url).searchParams.get("range") || "day";

    const now = new Date();
    const cutoffs: Record<string, Date> = {
      hour: new Date(now.getTime() - 3_600_000),
      day: new Date(now.getTime() - 86_400_000),
      week: new Date(now.getTime() - 7 * 86_400_000),
      month: new Date(now.getTime() - 30 * 86_400_000),
      year: new Date(now.getTime() - 365 * 86_400_000),
    };
    const since = cutoffs[range] || new Date(0);

    const supabase = await createSupabaseServiceClient();

    // Recent completions, each joined to the location of the find completed.
    // locations (migration 002) has name/address/latitude/longitude only — there
    // is no city/region/country column, so activity is reported per location.
    const { data: completions, error } = await supabase
      .from("find_completions")
      .select("id, completed_at, finds:finds!find_id(location_id, locations:locations!location_id(id, name, address, latitude, longitude))")
      .gte("completed_at", since.toISOString())
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(2000);
    if (error) throw new ApiError(500, error.message);

    interface LocationPoint {
      location_id: string;
      location: string;
      address: string | null;
      latitude: number;
      longitude: number;
      count: number;
    }

    const counts = new Map<string, LocationPoint>();
    let withoutLocation = 0;
    for (const c of completions || []) {
      const find = c.finds as unknown as {
        locations: { id: string; name: string; address: string | null; latitude: number; longitude: number } | null;
      } | null;
      const loc = find?.locations;
      if (!loc) {
        withoutLocation++;
        continue;
      }
      const existing = counts.get(loc.id);
      counts.set(loc.id, {
        location_id: loc.id,
        location: loc.name,
        address: loc.address,
        latitude: loc.latitude,
        longitude: loc.longitude,
        count: (existing?.count || 0) + 1,
      });
    }

    const points = Array.from(counts.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 100);

    return Response.json({
      range,
      total_completions: completions?.length || 0,
      completions_without_location: withoutLocation,
      points,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
