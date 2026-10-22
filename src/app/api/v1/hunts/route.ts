import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import {
  getAuthUser,
  requireRole,
  errorResponse,
  ApiError,
  sanitizeFilterInput,
} from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";
import { botGuard } from "@/lib/utils/bot-guard";
import { internalError } from "@/lib/utils/internal-error";
import { withoutInternalReviewFields } from "@/lib/hunts/review";
import { logger } from "@/lib/utils/logger";

/** Catalogue rows without review bookkeeping (who reviewed/affirmed, notes). */
function publicRows(rows: unknown): unknown {
  return Array.isArray(rows)
    ? rows.map((row) => (row && typeof row === "object" ? withoutInternalReviewFields(row as Record<string, unknown>) : row))
    : rows;
}

/**
 * search_hunts() returns a fixed column list without cover_image_url
 * (migration 079 added the column), so read the covers for its rows and merge
 * them in. A failed lookup only costs the photos: cards fall back to art.
 */
async function withCoverImages(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceClient>>,
  rows: unknown
): Promise<unknown> {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const ids = rows
    .map((row) => (row && typeof row === "object" ? (row as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
  const { data, error } = await supabase.from("hunts").select("id, cover_image_url").in("id", ids);
  if (error) logger.warn("hunts.nearby.covers_failed", { error: error.message });
  const covers = new Map(
    ((data || []) as { id: string; cover_image_url: string | null }[]).map((h) => [h.id, h.cover_image_url])
  );
  return rows.map((row) =>
    row && typeof row === "object"
      ? { ...row, cover_image_url: covers.get((row as { id?: string }).id ?? "") ?? null }
      : row
  );
}

const DIFFICULTY_PROGRESSIONS = ["ascending", "descending", "mixed", "plateau"];

export async function GET(request: NextRequest) {
  const blocked = await botGuard(request);
  if (blocked) return blocked;

  try {
    await generalLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const radius = searchParams.get("radius") || "50";
    const q = searchParams.get("q");
    const audience = searchParams.get("audience");
    const template = searchParams.get("template");
    const mine = searchParams.get("mine");

    const supabase = await createSupabaseServiceClient();

    // If requesting own hunts, require auth
    if (mine === "true") {
      const user = await getAuthUser(request);
      if (!user) throw new ApiError(401, "Not authenticated");

      const { data, error } = await supabase
        .from("hunts")
        .select("*")
        .eq("created_by", user.id)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false });

      if (error) throw internalError("/api/v1/hunts", error);
      return Response.json({ hunts: data });
    }

    // Public search via PostGIS function
    if (lat && lng) {
      const { data, error } = await supabase.rpc("search_hunts", {
        lat: parseFloat(lat),
        lng: parseFloat(lng),
        radius_km: parseFloat(radius),
        search_query: q || null,
        audience: audience || null,
        max_results: 50,
      });

      if (error) throw internalError("/api/v1/hunts nearby", error);
      return Response.json({ hunts: publicRows(await withCoverImages(supabase, data)) });
    }

    // Basic list of public hunts
    let query = supabase
      .from("hunts")
      .select("*")
      .is("deleted_at", null)
      .eq("is_public", true)
      .in("status", ["published", "enrollment_open"])
      .order("created_at", { ascending: false })
      .limit(50);

    if (template === "true") {
      query = query.eq("is_template", true);
    }
    if (q) {
      const safeQ = sanitizeFilterInput(q);
      query = query.or(`title.ilike.%${safeQ}%,description.ilike.%${safeQ}%`);
    }
    if (audience) {
      const safeAudience = sanitizeFilterInput(audience);
      query = query.or(`target_audience.eq.${safeAudience},target_audience.eq.all`);
    }

    const { data, error } = await query;
    if (error) throw internalError("/api/v1/hunts list", error);

    return Response.json({ hunts: publicRows(data) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    requireRole(user, "teacher", "hunt_creator", "admin", "researcher");

    const body = await request.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) throw new ApiError(400, "Hunt title is required");

    const supabase = await createSupabaseServiceClient();

    const { data: hunt, error } = await supabase
      .from("hunts")
      .insert({
        title,
        description: body.description || null,
        target_audience: body.target_audience || "all",
        play_mode: body.play_mode || "solo",
        center_latitude: body.center_latitude ?? null,
        center_longitude: body.center_longitude ?? null,
        search_radius_km: body.search_radius_km || null,
        estimated_duration_min: body.estimated_duration_min || null,
        grade_range_min: body.grade_range_min || null,
        grade_range_max: body.grade_range_max || null,
        subject_domains: body.subject_domains || [],
        max_teams: body.max_teams || null,
        min_team_size: body.min_team_size || 1,
        max_team_size: body.max_team_size || 6,
        identity_mode: body.identity_mode || "codename_assigned",
        is_template: body.is_template || false,
        metadata: body.metadata || {},
        theme: body.theme || null,
        theme_narrative: body.theme_narrative || null,
        // Column has a CHECK constraint; anything else falls back to the DB default.
        ...(DIFFICULTY_PROGRESSIONS.includes(body.difficulty_progression)
          ? { difficulty_progression: body.difficulty_progression }
          : {}),
        created_by: user.id,
      })
      .select()
      .single();

    if (error) throw internalError("/api/v1/hunts", error);

    return Response.json({ hunt }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
