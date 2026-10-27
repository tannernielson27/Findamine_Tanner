import { NextRequest } from "next/server";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { errorResponse, ApiError } from "@/lib/utils/api-auth";
import { generalLimiter } from "@/lib/utils/rate-limit";

// Framework and standards listings are static reference data, identical for every viewer.
const PUBLIC_CACHE = { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" };

/**
 * Browse the curriculum library.
 * Supports filtering by subject, grade, location type, challenge type, and search query.
 */
export async function GET(request: NextRequest) {
  try {
    await generalLimiter.check(request);
    const { searchParams } = new URL(request.url);
    const subject = searchParams.get("subject");
    const gradeMin = searchParams.get("grade_min");
    const gradeMax = searchParams.get("grade_max");
    const locationType = searchParams.get("location_type");
    const locationDep = searchParams.get("location_dependency");
    const challengeType = searchParams.get("challenge_type");
    const rawQ = searchParams.get("q");
    const q = rawQ ? rawQ.slice(0, 100).replace(/%/g, "\\%").replace(/_/g, "\\_") : null;
    const tag = searchParams.get("tag")?.slice(0, 50) || null;
    const theme = searchParams.get("theme");
    const difficultyMin = searchParams.get("difficulty_min");
    const difficultyMax = searchParams.get("difficulty_max");
    const standardCode = searchParams.get("standard"); // filter by education standard code
    const frameworkCode = searchParams.get("framework"); // filter by framework code
    const type = searchParams.get("type") || "tasks"; // tasks, primers, standards, or frameworks
    const limit = parseInt(searchParams.get("limit") || "50");

    const supabase = await createSupabaseServiceClient();

    // ── Frameworks listing ──
    if (type === "frameworks") {
      const { data, error } = await supabase
        .from("standard_frameworks")
        .select("*")
        .order("sort_order")
        .limit(limit);
      if (error) throw new ApiError(500, error.message);
      return Response.json({ frameworks: data || [] }, { headers: PUBLIC_CACHE });
    }

    // ── Standards listing ──
    if (type === "standards") {
      let sQuery = supabase
        .from("education_standards")
        .select("*, standard_frameworks(code, name, abbreviation)")
        .order("sort_order")
        .limit(limit);

      if (frameworkCode) {
        const { data: fw } = await supabase
          .from("standard_frameworks")
          .select("id")
          .eq("code", frameworkCode)
          .single();
        if (fw) sQuery = sQuery.eq("framework_id", fw.id);
      }
      if (gradeMin) sQuery = sQuery.gte("grade_range_max", parseInt(gradeMin));
      if (gradeMax) sQuery = sQuery.lte("grade_range_min", parseInt(gradeMax));
      if (q) sQuery = sQuery.or(`code.ilike.%${q}%,description.ilike.%${q}%,domain.ilike.%${q}%`);

      const { data, error } = await sQuery;
      if (error) throw new ApiError(500, error.message);
      return Response.json({ standards: data || [] }, { headers: PUBLIC_CACHE });
    }

    if (type === "primers") {
      let query = supabase
        .from("primers")
        .select("*")
        .eq("is_library", true)
        .is("deleted_at", null)
        .order("subject_domain")
        .limit(limit);

      if (subject) query = query.eq("subject_domain", subject);
      if (locationDep) query = query.eq("location_dependency", locationDep);
      if (locationType && locationType !== "any") query = query.eq("location_type", locationType);
      if (tag) query = query.contains("tags", [tag]);
      if (theme) query = query.contains("themes", [theme]);
      if (difficultyMin) query = query.gte("difficulty_rating", parseInt(difficultyMin));
      if (difficultyMax) query = query.lte("difficulty_rating", parseInt(difficultyMax));
      if (q) query = query.or(`title.ilike.%${q}%`);

      const { data, error } = await query;
      if (error) throw new ApiError(500, error.message);
      return Response.json({ primers: data || [] });
    }

    // If filtering by standard, query through the alignment table
    if (standardCode) {
      const { data: std } = await supabase
        .from("education_standards")
        .select("id")
        .eq("code", standardCode)
        .maybeSingle();

      if (!std) {
        return Response.json({ tasks: [], standard_not_found: true });
      }

      const { data: alignments } = await supabase
        .from("task_standard_alignments")
        .select("task_id, alignment_strength, tasks(*)")
        .eq("standard_id", std.id)
        .limit(limit);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tasks = (alignments || []).map((a: any) => {
        const taskData = Array.isArray(a.tasks) ? a.tasks[0] : a.tasks;
        return { ...taskData, alignment_strength: a.alignment_strength };
      });

      return Response.json({ tasks, standard: standardCode });
    }

    // Tasks (default)
    let query = supabase
      .from("tasks")
      .select("*")
      .eq("is_library", true)
      .is("deleted_at", null)
      .order("subject_domain")
      .order("grade_range_min")
      .limit(limit);

    if (subject) query = query.eq("subject_domain", subject);
    if (challengeType) query = query.eq("challenge_type", challengeType);
    if (locationDep) query = query.eq("location_dependency", locationDep);
    if (locationType && locationType !== "any") query = query.eq("location_type", locationType);
    if (gradeMin) query = query.gte("grade_range_max", parseInt(gradeMin));
    if (gradeMax) query = query.lte("grade_range_min", parseInt(gradeMax));
    if (tag) query = query.contains("tags", [tag]);
    if (theme) query = query.contains("themes", [theme]);
    if (difficultyMin) query = query.gte("difficulty_rating", parseInt(difficultyMin));
    if (difficultyMax) query = query.lte("difficulty_rating", parseInt(difficultyMax));
    if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw new ApiError(500, error.message);

    return Response.json({ tasks: data || [] });
  } catch (error) {
    return errorResponse(error);
  }
}
